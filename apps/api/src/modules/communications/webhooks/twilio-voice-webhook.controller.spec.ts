const validateRequest = jest.fn();

jest.mock('twilio', () => {
  const fn: any = jest.fn();
  fn.validateRequest = validateRequest;
  return fn;
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TwilioVoiceWebhookController } from './twilio-voice-webhook.controller';

/**
 * Wave E — the Twilio voice-status webhook is PUBLIC (no JwtAuthGuard) but
 * must never trust an unverified payload: a bad/missing signature is
 * rejected with 403 and `CommunicationsService.applyVoiceStatusWebhook` is
 * never invoked. Only a request whose `X-Twilio-Signature` verifies against
 * the exact `PUBLIC_API_URL + path + query` reaches it — mirroring
 * `stripe-webhook.controller.spec.ts`'s "reject unverified, never call the
 * handler" shape.
 */
function makeReq(body: Record<string, string>, originalUrl: string, signature?: string) {
  return {
    body,
    originalUrl,
    header: (name: string) => (name === 'X-Twilio-Signature' ? signature : undefined),
  } as any;
}

describe('TwilioVoiceWebhookController', () => {
  const originalAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const originalPublicUrl = process.env.PUBLIC_API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TWILIO_AUTH_TOKEN = 'authtoken';
    process.env.PUBLIC_API_URL = 'https://api.example.com';
  });

  afterAll(() => {
    if (originalAuthToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = originalAuthToken;
    if (originalPublicUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = originalPublicUrl;
  });

  it('rejects with 403 when TWILIO_AUTH_TOKEN/PUBLIC_API_URL is unset, and never calls the service', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const comms = { applyVoiceStatusWebhook: jest.fn() };
    const controller = new TwilioVoiceWebhookController(comms as any);
    const req = makeReq(
      { CallSid: 'CA1', CallStatus: 'completed' },
      '/api/v1/comms/webhooks/twilio/voice-status?tenantId=t1&callSessionId=c1',
      'sig',
    );

    await expect(
      controller.handleVoiceStatus(req, 't1', 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(comms.applyVoiceStatusWebhook).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the X-Twilio-Signature header is missing', async () => {
    const comms = { applyVoiceStatusWebhook: jest.fn() };
    const controller = new TwilioVoiceWebhookController(comms as any);
    const req = makeReq(
      { CallSid: 'CA1', CallStatus: 'completed' },
      '/api/v1/comms/webhooks/twilio/voice-status?tenantId=t1&callSessionId=c1',
      undefined,
    );

    await expect(controller.handleVoiceStatus(req, 't1', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(comms.applyVoiceStatusWebhook).not.toHaveBeenCalled();
  });

  it('rejects with 400 when tenantId/callSessionId query params are missing', async () => {
    const comms = { applyVoiceStatusWebhook: jest.fn() };
    const controller = new TwilioVoiceWebhookController(comms as any);
    const req = makeReq({ CallSid: 'CA1', CallStatus: 'completed' }, '/api/v1/comms/webhooks/twilio/voice-status', 'sig');

    await expect(controller.handleVoiceStatus(req, undefined, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(comms.applyVoiceStatusWebhook).not.toHaveBeenCalled();
  });

  it('rejects with 403 on an invalid signature, and never calls the service', async () => {
    validateRequest.mockReturnValue(false);
    const comms = { applyVoiceStatusWebhook: jest.fn() };
    const controller = new TwilioVoiceWebhookController(comms as any);
    const req = makeReq(
      { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '42' },
      '/api/v1/comms/webhooks/twilio/voice-status?tenantId=t1&callSessionId=c1',
      'bad_sig',
    );

    await expect(controller.handleVoiceStatus(req, 't1', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(comms.applyVoiceStatusWebhook).not.toHaveBeenCalled();
  });

  it('rejects with 400 when the payload is missing CallSid/CallStatus, even with a valid signature', async () => {
    validateRequest.mockReturnValue(true);
    const comms = { applyVoiceStatusWebhook: jest.fn() };
    const controller = new TwilioVoiceWebhookController(comms as any);
    const req = makeReq({}, '/api/v1/comms/webhooks/twilio/voice-status?tenantId=t1&callSessionId=c1', 'good_sig');

    await expect(controller.handleVoiceStatus(req, 't1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(comms.applyVoiceStatusWebhook).not.toHaveBeenCalled();
  });

  it('verifies against the exact PUBLIC_API_URL + originalUrl and updates the CallSession on a valid signature', async () => {
    validateRequest.mockReturnValue(true);
    const comms = { applyVoiceStatusWebhook: jest.fn().mockResolvedValue(undefined) };
    const controller = new TwilioVoiceWebhookController(comms as any);
    const body = { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '42' };
    const req = makeReq(body, '/api/v1/comms/webhooks/twilio/voice-status?tenantId=tenant_demo&callSessionId=call_abc', 'good_sig');

    const result = await controller.handleVoiceStatus(req, 'tenant_demo', 'call_abc');

    expect(result).toEqual({ received: true });
    expect(validateRequest).toHaveBeenCalledWith(
      'authtoken',
      'good_sig',
      'https://api.example.com/api/v1/comms/webhooks/twilio/voice-status?tenantId=tenant_demo&callSessionId=call_abc',
      body,
    );
    expect(comms.applyVoiceStatusWebhook).toHaveBeenCalledWith('tenant_demo', 'call_abc', 'CA1', 'completed', 42);
  });
});
