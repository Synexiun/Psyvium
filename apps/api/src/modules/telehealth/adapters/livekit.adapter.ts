import { Logger } from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';
import type { VideoJoinGrant, VideoJoinToken, VideoProvider } from '../ports/video-provider.port';

/**
 * Real LiveKit Cloud adapter (activate-on-key, same pattern as
 * `finance/adapters/stripe-payment.adapter.ts` /
 * `communications/adapters/twilio-sms.adapter.ts`). Selected by
 * `TelehealthService` only when `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` +
 * `LIVEKIT_URL` are ALL present; with any one missing, `fromEnv()` returns
 * `null` and the service falls back to an honest 503
 * `VIDEO_NOT_CONFIGURED` — never a fake token that connects nowhere.
 *
 * Tokens minted here are ROOM-SCOPED (`VideoGrant.room` pins the token to
 * exactly one LiveKit room), IDENTITY-BOUND (`identity` is the caller's
 * stable VPSY user id, never a session-local nonce), and SHORT-TTL (doc §14
 * HIPAA safeguards table — 15 minutes, passed in by the caller as
 * `grant.ttlSeconds`). LiveKit Cloud auto-creates the room on first join —
 * this adapter never needs a separate `RoomServiceClient` call.
 */
export class LiveKitAdapter implements VideoProvider {
  private readonly logger = new Logger(LiveKitAdapter.name);

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly url: string,
  ) {}

  /** Build from env, or null when any of LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL is unset. */
  static fromEnv(): LiveKitAdapter | null {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) return null;
    return new LiveKitAdapter(apiKey, apiSecret, url);
  }

  async mintJoinToken(grant: VideoJoinGrant): Promise<VideoJoinToken> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: grant.identity,
      name: grant.name,
      ttl: grant.ttlSeconds,
    });
    at.addGrant({
      roomJoin: true,
      room: grant.room,
      canPublish: grant.canPublish,
      canSubscribe: grant.canSubscribe,
    });
    const token = await at.toJwt();
    this.logger.log(`[livekit] minted join token for room=${grant.room} identity=${grant.identity}`);
    return {
      token,
      url: this.url,
      roomName: grant.room,
      expiresAt: new Date(Date.now() + grant.ttlSeconds * 1000).toISOString(),
    };
  }
}
