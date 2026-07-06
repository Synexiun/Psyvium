import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import twilio, { type Twilio } from 'twilio';
import type { PlaceCallResult, TelephonyProvider } from '../ports/telephony-provider.port';

/**
 * Real Twilio voice adapter (activate-on-config, Wave E — the last comms
 * stub). Unlike SMS (`twilio-sms.adapter.ts`), voice is inherently
 * asynchronous: `calls.create` only originates the call; Twilio reports
 * ringing/answered/completed later via a status-callback webhook
 * (`../webhooks/twilio-voice-webhook.controller.ts`). That webhook must be
 * reachable from the public internet, so this adapter activates ONLY when
 * ALL THREE of `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
 * `PUBLIC_API_URL` are set — the first two alone are sufficient for SMS but
 * not for voice: with no public callback URL there is no way for Twilio to
 * ever tell us how the call ended, and `CommunicationsService` refuses to
 * either fabricate an outcome or leave a `CallSession` stuck `RINGING`
 * forever. With any one of the three unset, the offline stub stays active
 * (`15-communications-and-telephony.md` §2.3).
 *
 * v1 call flow (single outbound leg — there is no clinician telephony
 * endpoint modeled yet; `ClickToCallInput` carries only the client's
 * `toE164`, never a clinician device address):
 *   1. Twilio dials `to` (the client) with caller ID `from` (the tenant's
 *      provisioned VOICE-capable `PhoneNumber`).
 *   2. Once answered, the inline TwiML plays a brief `<Say>` identifying the
 *      clinic, then `<Dial><Conference>` parks the call in a
 *      per-`CallSession` conference room instead of letting the TwiML
 *      document simply end (which would make Twilio hang up immediately
 *      after the announcement — the opposite of "keep the call"). Naming the
 *      conference room after the `CallSession` id is also a real extension
 *      point: a future clinician softphone/WebRTC leg can dial into the same
 *      room to complete the two-way bridge described in `15` §3.2 — that
 *      second leg is out of scope for this ticket.
 *   3. `statusCallback` is registered for `initiated`/`answered`/`completed`
 *      and carries `tenantId`+`callSessionId` as query params so the webhook
 *      can bind `TenantContext` before touching RLS-scoped tables — see that
 *      controller's doc comment for why embedding tenant identity in a
 *      Twilio-signed URL is safe.
 *
 * Every outcome here is honest: a successful `calls.create` returns
 * `INITIATED` (never a fabricated `COMPLETED`); an API-level failure (bad
 * number, auth error, etc.) returns `FAILED` synchronously, since no webhook
 * will ever arrive for a call that was never placed.
 */
export class TwilioVoiceAdapter implements TelephonyProvider {
  private readonly logger = new Logger(TwilioVoiceAdapter.name);
  private readonly client: Twilio;

  constructor(
    accountSid: string,
    authToken: string,
    private readonly publicApiUrl: string,
  ) {
    this.client = twilio(accountSid, authToken);
  }

  /** Build from env, or null when voice's full config (all three vars) isn't present. */
  static fromEnv(): TwilioVoiceAdapter | null {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const publicApiUrl = process.env.PUBLIC_API_URL;
    if (!sid || !token || !publicApiUrl) return null;
    return new TwilioVoiceAdapter(sid, token, publicApiUrl);
  }

  async placeCall(from: string, to: string, context?: Record<string, unknown>): Promise<PlaceCallResult> {
    const tenantId = typeof context?.tenantId === 'string' ? context.tenantId : undefined;
    const callSessionId = typeof context?.callSessionId === 'string' ? context.callSessionId : undefined;

    const statusCallback = new URL(
      `${this.publicApiUrl.replace(/\/+$/, '')}/api/v1/comms/webhooks/twilio/voice-status`,
    );
    if (tenantId) statusCallback.searchParams.set('tenantId', tenantId);
    if (callSessionId) statusCallback.searchParams.set('callSessionId', callSessionId);

    const conferenceRoom = `call_${callSessionId ?? randomBytes(6).toString('hex')}`;
    const twiml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response>' +
      '<Say>This is a call from your care team. Please hold, connecting you now.</Say>' +
      '<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true">' +
      conferenceRoom +
      '</Conference></Dial>' +
      '</Response>';

    try {
      const call = await this.client.calls.create({
        from,
        to,
        twiml,
        statusCallback: statusCallback.toString(),
        statusCallbackEvent: ['initiated', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      });
      this.logger.debug(`[twilio-voice] placeCall ${from} -> ${to} sid=${call.sid} status=${call.status}`);
      return { providerRef: call.sid, status: 'INITIATED', durationSec: 0 };
    } catch (err) {
      const e = err as { code?: number | string; message?: string };
      this.logger.warn(
        `[twilio-voice] placeCall failed ${from} -> ${to}: ${e.code ?? ''} ${e.message ?? String(err)}`,
      );
      return { providerRef: `twilio_error_${e.code ?? 'unknown'}`, status: 'FAILED', durationSec: 0 };
    }
  }
}
