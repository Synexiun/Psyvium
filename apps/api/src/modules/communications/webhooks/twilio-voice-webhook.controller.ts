import { BadRequestException, Controller, ForbiddenException, Logger, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import twilio from 'twilio';
import { TenantContext } from '../../../common/prisma/tenant-context';
import { CommunicationsService } from '../communications.service';

/**
 * Twilio call status-callback webhook (`docs/technical/15-communications-
 * and-telephony.md` §3.2, §10.5 `CallCompleted`). Deliberately its OWN
 * controller (not a route on `CommunicationsController`) because it must be
 * PUBLIC — Twilio cannot present a VPSY session cookie or bearer token, so
 * `CommunicationsController`'s `@UseGuards(JwtAuthGuard, PermissionsGuard)`
 * cannot apply here. "Public" is safe only because every request's
 * `X-Twilio-Signature` is verified against `TWILIO_AUTH_TOKEN` before any
 * side effect runs — an unsigned or mis-signed request is rejected with 403
 * and never reaches `CommunicationsService`. The global
 * `PrincipalThrottlerGuard` (IP-keyed for an unauthenticated caller) still
 * applies, tightened further below (mirrors `stripe-webhook.controller.ts`).
 *
 * BODY GOTCHA (unlike Stripe): Twilio's signature does NOT sign raw bytes —
 * it HMACs the exact callback URL (including query string) concatenated with
 * the sorted `POST` body parameters. Nest's default `express.urlencoded()`
 * body parser (registered automatically by `NestFactory.create`, active for
 * every route unless disabled) parses Twilio's `application/x-www-form-
 * urlencoded` webhook body into `req.body` as flat string key/value pairs —
 * exactly the shape `twilio.validateRequest` expects. No `rawBody: true` /
 * `RawBodyRequest` needed here (that is a Stripe-specific requirement).
 *
 * TENANT CONTEXT: this route runs with no JWT, so the global
 * `TenantContextMiddleware` leaves the RLS backstop's tenant GUC unset, and
 * `CallSession` is a tenant-scoped table. Twilio has no notion of a "VPSY
 * tenant" to attach to its webhook, so `TwilioVoiceAdapter.placeCall` embeds
 * `tenantId` and `callSessionId` as query params directly on the
 * `statusCallback` URL it registers with Twilio at call-creation time.
 * Twilio's signature algorithm covers the ENTIRE URL it was given, including
 * that query string — so a request whose `tenantId`/`callSessionId` params
 * were tampered with in transit would fail `twilio.validateRequest` outright.
 * That is what makes it safe to bind `TenantContext.run({ tenantId })` from a
 * query param on an otherwise-unauthenticated route: the signature check IS
 * the authentication for the tenant claim (the same pattern
 * `stripe-webhook.controller.ts` uses for `metadata.tenantId`, just carried
 * in the URL instead of a signed JSON body). `CommunicationsService
 * .applyVoiceStatusWebhook` then independently verifies the `CallSession`
 * exists for that tenant/id and cross-checks Twilio's `CallSid` against any
 * `providerRef` already on the row before writing anything.
 */
@ApiExcludeController()
@Controller('comms/webhooks')
export class TwilioVoiceWebhookController {
  private readonly logger = new Logger(TwilioVoiceWebhookController.name);

  constructor(private readonly comms: CommunicationsService) {}

  @Post('twilio/voice-status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async handleVoiceStatus(
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
    @Query('callSessionId') callSessionId?: string,
  ): Promise<{ received: boolean }> {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const publicApiUrl = process.env.PUBLIC_API_URL;
    const signature = req.header('X-Twilio-Signature');

    if (!authToken || !publicApiUrl) {
      this.logger.warn(
        'Twilio voice-status webhook received but TWILIO_AUTH_TOKEN / PUBLIC_API_URL is unset — rejecting ' +
          '(cannot verify signature, so we never risk trusting an unverified payload).',
      );
      throw new ForbiddenException('Twilio voice webhook is not configured.');
    }
    if (!signature) {
      throw new ForbiddenException('Missing X-Twilio-Signature header.');
    }
    if (!tenantId || !callSessionId) {
      throw new BadRequestException('Missing tenantId/callSessionId query parameters.');
    }

    // Reconstruct the exact URL Twilio was given (PUBLIC_API_URL + path +
    // query string) — never trust req.protocol/req.get('host'), which can
    // differ from the public URL behind a proxy/load balancer and would make
    // a legitimate request fail signature verification.
    const fullUrl = `${publicApiUrl.replace(/\/+$/, '')}${req.originalUrl}`;
    const params = (req.body ?? {}) as Record<string, string>;
    const valid = twilio.validateRequest(authToken, signature, fullUrl, params);
    if (!valid) {
      this.logger.warn(
        `Twilio voice-status webhook signature verification FAILED for tenant=${tenantId} call=${callSessionId}.`,
      );
      throw new ForbiddenException('Invalid Twilio signature.');
    }

    const callSid = params.CallSid;
    const twilioCallStatus = params.CallStatus;
    const durationSec = params.CallDuration !== undefined ? Number(params.CallDuration) : undefined;

    if (!callSid || !twilioCallStatus) {
      throw new BadRequestException('Missing CallSid/CallStatus in Twilio payload.');
    }

    await TenantContext.run({ tenantId }, () =>
      this.comms.applyVoiceStatusWebhook(tenantId, callSessionId, callSid, twilioCallStatus, durationSec),
    );

    return { received: true };
  }
}
