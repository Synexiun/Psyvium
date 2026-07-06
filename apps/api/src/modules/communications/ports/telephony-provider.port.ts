/**
 * `TelephonyProvider` port (`docs/technical/15-communications-and-telephony.md`
 * §2.1). Domain/application code depends only on this interface — never on a
 * vendor SDK. A self-hosted SIP/PBX adapter and a cloud (Twilio/Vonage-class)
 * adapter both satisfy it; swapping is a tenant configuration change.
 *
 * Only `placeCall` is exercised by this ticket's use cases (click-to-call).
 * The remaining methods from the doc's port table are declared as the
 * documented seam for later adapters (inbound routing/IVR, recording,
 * hangup) — real implementations are out of scope here and MUST NOT reach
 * the network; see `adapters/offline-stub.adapter.ts`.
 */
export interface PlaceCallResult {
  providerRef: string;
  /**
   * `INITIATED` (Wave E) is a distinct outcome from the offline stub's
   * synchronous set: a real async adapter (`adapters/twilio-voice.adapter.ts`)
   * only ORIGINATES the call here — it has no answer/disposition yet, so it
   * cannot honestly report `COMPLETED`/`NO_ANSWER`/`FAILED`. The terminal
   * status and `durationSec` arrive later out-of-band via the adapter's
   * status-callback webhook, which drives the rest of the `CallSession`
   * lifecycle. The offline stub never returns `INITIATED` — it always
   * "completes" synchronously (see its own doc comment).
   */
  status: 'INITIATED' | 'COMPLETED' | 'NO_ANSWER' | 'FAILED';
  durationSec: number;
}

export interface TelephonyProvider {
  /** Originate an outbound call; returns a provider reference. */
  placeCall(from: string, to: string, context?: Record<string, unknown>): Promise<PlaceCallResult>;

  /** Begin recording; a real adapter refuses without a valid consent id. */
  startRecording?(callId: string, consentId: string): Promise<{ storageKey: string }>;

  /** End recording, finalize the storage object. */
  stopRecording?(callId: string): Promise<void>;

  /** Terminate a call. */
  hangup?(callId: string, reason: string): Promise<void>;
}

export const TELEPHONY_PROVIDER = Symbol('TELEPHONY_PROVIDER');
