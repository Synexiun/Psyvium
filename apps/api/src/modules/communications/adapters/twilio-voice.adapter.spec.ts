const callsCreate = jest.fn();

jest.mock('twilio', () => {
  const fn: any = jest.fn().mockImplementation(() => ({ calls: { create: callsCreate } }));
  return fn;
});

import { TwilioVoiceAdapter } from './twilio-voice.adapter';

/**
 * Wave E — voice is activate-on-config, not just activate-on-key: unlike
 * `TwilioSmsAdapter.fromEnv()` (needs only the two Twilio credentials),
 * `TwilioVoiceAdapter.fromEnv()` additionally requires `PUBLIC_API_URL`,
 * because the status-callback webhook it registers with Twilio must be
 * reachable from the public internet.
 */
describe('TwilioVoiceAdapter.fromEnv', () => {
  const originalSid = process.env.TWILIO_ACCOUNT_SID;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;
  const originalPublicUrl = process.env.PUBLIC_API_URL;

  afterEach(() => {
    if (originalSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = originalSid;
    if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = originalToken;
    if (originalPublicUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = originalPublicUrl;
  });

  it('returns null with no env set at all', () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.PUBLIC_API_URL;
    expect(TwilioVoiceAdapter.fromEnv()).toBeNull();
  });

  it('returns null with only TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN set (no PUBLIC_API_URL)', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_AUTH_TOKEN = 'authtoken';
    delete process.env.PUBLIC_API_URL;
    expect(TwilioVoiceAdapter.fromEnv()).toBeNull();
  });

  it('returns null with only PUBLIC_API_URL set (no Twilio credentials)', () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.PUBLIC_API_URL = 'https://api.example.com';
    expect(TwilioVoiceAdapter.fromEnv()).toBeNull();
  });

  it('returns an adapter instance only when all three env vars are set', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_AUTH_TOKEN = 'authtoken';
    process.env.PUBLIC_API_URL = 'https://api.example.com';
    expect(TwilioVoiceAdapter.fromEnv()).toBeInstanceOf(TwilioVoiceAdapter);
  });
});

describe('TwilioVoiceAdapter.placeCall', () => {
  beforeEach(() => jest.clearAllMocks());

  it('originates the call with a status-callback URL carrying tenantId/callSessionId, and returns INITIATED', async () => {
    callsCreate.mockResolvedValue({ sid: 'CA123', status: 'queued' });
    const adapter = new TwilioVoiceAdapter('ACxxx', 'authtoken', 'https://api.example.com');

    const result = await adapter.placeCall('+15551110000', '+15551230099', {
      clientId: 'client_1',
      purpose: 'care',
      tenantId: 'tenant_demo',
      callSessionId: 'call_abc',
    });

    expect(result).toEqual({ providerRef: 'CA123', status: 'INITIATED', durationSec: 0 });
    expect(callsCreate).toHaveBeenCalledTimes(1);
    const args = callsCreate.mock.calls[0][0];
    expect(args.from).toBe('+15551110000');
    expect(args.to).toBe('+15551230099');
    expect(args.statusCallbackEvent).toEqual(['initiated', 'answered', 'completed']);
    expect(args.statusCallbackMethod).toBe('POST');
    expect(args.statusCallback).toBe(
      'https://api.example.com/api/v1/comms/webhooks/twilio/voice-status?tenantId=tenant_demo&callSessionId=call_abc',
    );
    expect(args.twiml).toContain('<Say>');
    expect(args.twiml).toContain('<Dial>');
    expect(args.twiml).toContain('<Conference');
    expect(args.twiml).toContain('call_call_abc');
  });

  it('maps a Twilio API/auth error to a synchronous FAILED outcome, never throwing', async () => {
    callsCreate.mockRejectedValue({ code: 21211, message: 'Invalid \'To\' Phone Number' });
    const adapter = new TwilioVoiceAdapter('ACxxx', 'authtoken', 'https://api.example.com');

    const result = await adapter.placeCall('+15551110000', 'not-a-number', {
      tenantId: 'tenant_demo',
      callSessionId: 'call_abc',
    });

    expect(result.status).toBe('FAILED');
    expect(result.providerRef).toBe('twilio_error_21211');
    expect(result.durationSec).toBe(0);
  });
});
