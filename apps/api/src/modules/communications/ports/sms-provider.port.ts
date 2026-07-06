/**
 * `SmsProvider` port (`docs/technical/15-communications-and-telephony.md`
 * §2.2). Self-hosted SIP-SMS-gateway and cloud (Twilio/Vonage-class) adapters
 * both satisfy this — a tenant may mix cloud SMS with self-hosted voice.
 *
 * Only `sendSms` is exercised by this ticket's use cases. `optOut`/`optIn`
 * are declared as the documented seam for STOP/START keyword handling
 * (`15` §4.4) — not wired to a real inbound webhook here.
 */
export interface SendSmsResult {
  providerRef: string;
  status: 'SENT' | 'FAILED';
}

export interface SmsProvider {
  /** Queue an outbound SMS; returns a provider reference. */
  sendSms(to: string, from: string, body: string, templateId?: string): Promise<SendSmsResult>;

  /** Update the suppression list from a STOP/START keyword. */
  optOut?(e164: string): Promise<void>;
  optIn?(e164: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
