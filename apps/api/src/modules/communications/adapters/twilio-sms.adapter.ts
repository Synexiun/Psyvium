import { Logger } from '@nestjs/common';
import twilio, { type Twilio } from 'twilio';
import type { SendSmsResult, SmsProvider } from '../ports/sms-provider.port';

/**
 * Real Twilio SMS adapter (activate-on-key). Selected by the Communications
 * service only when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are present; with no
 * credentials the service keeps the offline stub. We never fabricate a delivery:
 * a Twilio accept maps to SENT (the service drives SENT -> DELIVERED from there),
 * and any provider/auth error is recorded honestly as FAILED — not a fake SENT.
 *
 * `from` is the tenant's provisioned number and must be a Twilio-owned number in
 * production. Voice (click-to-call) is intentionally NOT implemented here: real
 * Twilio voice is async (status arrives via webhook) and does not map to the
 * synchronous TelephonyProvider port without a public status-callback endpoint.
 */
export class TwilioSmsAdapter implements SmsProvider {
  private readonly logger = new Logger(TwilioSmsAdapter.name);
  private readonly client: Twilio;

  constructor(accountSid: string, authToken: string) {
    this.client = twilio(accountSid, authToken);
  }

  /** Build from env, or null when no Twilio credentials are configured. */
  static fromEnv(): TwilioSmsAdapter | null {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return null;
    return new TwilioSmsAdapter(sid, token);
  }

  async sendSms(to: string, from: string, body: string): Promise<SendSmsResult> {
    try {
      const msg = await this.client.messages.create({ to, from, body });
      this.logger.debug(`[twilio] sendSms ${from} -> ${to} sid=${msg.sid} status=${msg.status}`);
      return { providerRef: msg.sid, status: 'SENT' };
    } catch (err) {
      const e = err as { code?: number | string; message?: string };
      this.logger.warn(`[twilio] sendSms failed ${from} -> ${to}: ${e.code ?? ''} ${e.message ?? String(err)}`);
      return { providerRef: `twilio_error_${e.code ?? 'unknown'}`, status: 'FAILED' };
    }
  }
}
