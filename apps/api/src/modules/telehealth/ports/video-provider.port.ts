/**
 * `VideoProvider` port (Wave F — Telehealth made REAL). The real adapter
 * (`../adapters/livekit.adapter.ts`) satisfies this only when LiveKit Cloud
 * is configured; with no credentials configured, `TelehealthService` never
 * calls this port at all — it returns an honest 503 `VIDEO_NOT_CONFIGURED`
 * instead of a fabricated token that connects nowhere.
 *
 * Mirrors the activate-on-key shape of `finance/ports/payment-provider.port.ts`
 * and `communications/ports/sms-provider.port.ts`: a provider-agnostic seam
 * so a second RTC provider can be added later without touching
 * `TelehealthService`'s lifecycle logic.
 */

export interface VideoJoinGrant {
  /** Stable per-user identity bound into the token (doc §14 — "identity-bound"), never a session-local nonce. */
  identity: string;
  /** Display name shown to other participants. */
  name?: string;
  /** LiveKit room name — always the TeleSession's own `roomName`. */
  room: string;
  canPublish: boolean;
  canSubscribe: boolean;
  /** Token time-to-live in seconds. Doc §14 mandates a SHORT TTL (15 min). */
  ttlSeconds: number;
}

export interface VideoJoinToken {
  token: string;
  url: string;
  roomName: string;
  /** ISO-8601 UTC — when this token stops being valid. */
  expiresAt: string;
}

export interface VideoProvider {
  /**
   * Mints a room-scoped, identity-bound, short-TTL join token. Never
   * fabricates success on a provider error — a thrown error here must
   * surface, not be swallowed into a fake token.
   */
  mintJoinToken(grant: VideoJoinGrant): Promise<VideoJoinToken>;
}
