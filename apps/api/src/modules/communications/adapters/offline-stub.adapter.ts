import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { PlaceCallResult, TelephonyProvider } from '../ports/telephony-provider.port';
import type { SendSmsResult, SmsProvider } from '../ports/sms-provider.port';

/**
 * Deterministic, no-network stub implementing BOTH provider ports — the
 * Communications Hub equivalent of `AiGatewayService`'s offline path
 * (`apps/api/src/modules/ai-gateway/ai-gateway.service.ts`). It is selected
 * whenever no real SIP/Twilio/Vonage adapter is configured, which today is
 * always: real adapters are a documented seam (`15-communications-and-
 * telephony.md` §2.3), never implemented against a live carrier here so the
 * whole platform stays demoable with zero external dependencies and no
 * outbound network calls of any kind.
 *
 * - `placeCall` always "completes" the call immediately with a short, fixed
 *   duration — there is no ringing/answer webhook to await offline.
 * - `sendSms` always "accepts" the message — the service layer drives the
 *   QUEUED → SENT → DELIVERED lifecycle from this single accept signal.
 */
@Injectable()
export class OfflineStubAdapter implements TelephonyProvider, SmsProvider {
  private readonly logger = new Logger(OfflineStubAdapter.name);

  /** Fixed, deterministic call duration for the offline stub (seconds). */
  static readonly STUB_CALL_DURATION_SEC = 45;

  async placeCall(from: string, to: string): Promise<PlaceCallResult> {
    this.logger.debug(`[offline-stub] placeCall ${from} -> ${to}`);
    return {
      providerRef: `stub_call_${randomBytes(6).toString('hex')}`,
      status: 'COMPLETED',
      durationSec: OfflineStubAdapter.STUB_CALL_DURATION_SEC,
    };
  }

  async sendSms(to: string, from: string): Promise<SendSmsResult> {
    this.logger.debug(`[offline-stub] sendSms ${from} -> ${to}`);
    return {
      providerRef: `stub_sms_${randomBytes(6).toString('hex')}`,
      status: 'SENT',
    };
  }
}
