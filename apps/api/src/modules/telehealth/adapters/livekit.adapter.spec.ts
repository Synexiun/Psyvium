const addGrant = jest.fn();
const toJwt = jest.fn();
const AccessTokenCtor = jest.fn().mockImplementation(() => ({ addGrant, toJwt }));

jest.mock('livekit-server-sdk', () => ({
  AccessToken: AccessTokenCtor,
}));

import { LiveKitAdapter } from './livekit.adapter';

/**
 * Wave F — LiveKitAdapter is activate-on-key (`fromEnv()` returns null
 * unless LIVEKIT_API_KEY + LIVEKIT_API_SECRET + LIVEKIT_URL are ALL set,
 * same pattern as `StripePaymentAdapter.fromEnv()`), and every minted token
 * must be room-scoped + identity-bound + short-TTL (doc §14).
 */
describe('LiveKitAdapter.fromEnv', () => {
  const originalKey = process.env.LIVEKIT_API_KEY;
  const originalSecret = process.env.LIVEKIT_API_SECRET;
  const originalUrl = process.env.LIVEKIT_URL;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.LIVEKIT_API_KEY;
    else process.env.LIVEKIT_API_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.LIVEKIT_API_SECRET;
    else process.env.LIVEKIT_API_SECRET = originalSecret;
    if (originalUrl === undefined) delete process.env.LIVEKIT_URL;
    else process.env.LIVEKIT_URL = originalUrl;
  });

  it('returns null when none of the LIVEKIT_* vars are set', () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.LIVEKIT_URL;
    expect(LiveKitAdapter.fromEnv()).toBeNull();
  });

  it('returns null when only some of the LIVEKIT_* vars are set (never partially active)', () => {
    process.env.LIVEKIT_API_KEY = 'key_123';
    process.env.LIVEKIT_API_SECRET = 'secret_123';
    delete process.env.LIVEKIT_URL;
    expect(LiveKitAdapter.fromEnv()).toBeNull();
  });

  it('returns an adapter instance when all three LIVEKIT_* vars are set', () => {
    process.env.LIVEKIT_API_KEY = 'key_123';
    process.env.LIVEKIT_API_SECRET = 'secret_123';
    process.env.LIVEKIT_URL = 'wss://demo.livekit.cloud';
    expect(LiveKitAdapter.fromEnv()).toBeInstanceOf(LiveKitAdapter);
  });
});

describe('LiveKitAdapter.mintJoinToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mints a room-scoped, identity-bound, short-TTL token', async () => {
    toJwt.mockResolvedValue('signed.jwt.token');
    const adapter = new LiveKitAdapter('key_123', 'secret_123', 'wss://demo.livekit.cloud');

    const result = await adapter.mintJoinToken({
      identity: 'user_client_1',
      room: 'tele_appt_1',
      canPublish: true,
      canSubscribe: true,
      ttlSeconds: 900,
    });

    expect(AccessTokenCtor).toHaveBeenCalledWith(
      'key_123',
      'secret_123',
      expect.objectContaining({ identity: 'user_client_1', ttl: 900 }),
    );
    expect(addGrant).toHaveBeenCalledWith({
      roomJoin: true,
      room: 'tele_appt_1',
      canPublish: true,
      canSubscribe: true,
    });
    expect(result.token).toBe('signed.jwt.token');
    expect(result.url).toBe('wss://demo.livekit.cloud');
    expect(result.roomName).toBe('tele_appt_1');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
