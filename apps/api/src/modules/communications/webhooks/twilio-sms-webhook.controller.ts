import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import twilio from 'twilio';
import { TenantContext } from '../../../common/prisma/tenant-context';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CommunicationsService } from '../communications.service';

/**
 * Twilio inbound SMS webhook for STOP/START keyword handling (doc 15 §4).
 * Public (no JWT) — authenticated only by X-Twilio-Signature, same pattern as
 * the voice status callback. Tenant is bound via query `tenantId` (preferred)
 * or by looking up the destination E.164 (`To`) in PhoneNumber.
 */
@ApiExcludeController()
@Controller('comms/webhooks')
export class TwilioSmsWebhookController {
  private readonly logger = new Logger(TwilioSmsWebhookController.name);

  constructor(
    private readonly comms: CommunicationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('twilio/sms-inbound')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async handleInboundSms(
    @Req() req: Request,
    @Res() res: Response,
    @Query('tenantId') tenantIdQuery?: string,
  ): Promise<void> {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const publicApiUrl = process.env.PUBLIC_API_URL;
    const signature = req.header('X-Twilio-Signature');

    if (!authToken || !publicApiUrl) {
      this.logger.warn(
        'Twilio sms-inbound webhook received but TWILIO_AUTH_TOKEN / PUBLIC_API_URL is unset — rejecting.',
      );
      throw new ForbiddenException('Twilio SMS webhook is not configured.');
    }
    if (!signature) {
      throw new ForbiddenException('Missing X-Twilio-Signature header.');
    }

    const fullUrl = `${publicApiUrl.replace(/\/+$/, '')}${req.originalUrl}`;
    const params = (req.body ?? {}) as Record<string, string>;
    const valid = twilio.validateRequest(authToken, signature, fullUrl, params);
    if (!valid) {
      this.logger.warn('Twilio sms-inbound webhook signature verification FAILED.');
      throw new ForbiddenException('Invalid Twilio signature.');
    }

    const from = params.From;
    const to = params.To;
    const body = params.Body ?? '';
    if (!from || !to) {
      throw new BadRequestException('Missing From/To in Twilio SMS payload.');
    }

    let tenantId = tenantIdQuery?.trim() || undefined;
    if (!tenantId) {
      const e164 = normalizeLookup(to);
      const number = await this.prisma.phoneNumber.findFirst({
        where: {
          OR: [{ e164: to }, { e164: `+${e164}` }, { e164 }],
        },
        select: { tenantId: true },
      });
      tenantId = number?.tenantId;
    }
    if (!tenantId) {
      this.logger.warn(`Twilio sms-inbound: could not resolve tenant for To=${to}`);
      throw new BadRequestException('Unable to resolve tenant for this number.');
    }

    const result = await TenantContext.run({ tenantId }, () =>
      this.comms.applyInboundSmsKeyword(tenantId!, from, body),
    );

    // Empty TwiML Response is a valid "no auto-reply" acknowledgement.
    // STOP confirmation text is optional; carriers also send their own DND notice.
    let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    if (result.action === 'opt_out') {
      twiml =
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>You are unsubscribed from SMS. Reply START to re-subscribe.</Message></Response>';
    } else if (result.action === 'opt_in') {
      twiml =
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>You are re-subscribed to SMS from this clinic.</Message></Response>';
    } else if (result.action === 'help') {
      twiml =
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Clinic SMS help: Reply STOP to unsubscribe, START to resubscribe. For crisis support in the US call or text 988. This channel is not for emergencies.</Message></Response>';
    }

    res.status(200).type('text/xml').send(twiml);
  }
}

function normalizeLookup(raw: string): string {
  return raw.replace(/[^\d+]/g, '').replace(/^\+/, '');
}
