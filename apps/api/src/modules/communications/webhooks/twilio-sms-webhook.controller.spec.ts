const validateRequest = jest.fn();

jest.mock('twilio', () => {
  const fn: any = jest.fn();
  fn.validateRequest = validateRequest;
  return fn;
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TwilioSmsWebhookController } from './twilio-sms-webhook.controller';

function makeReq(body: Record<string, string>, originalUrl: string, signature?: string) {
  return {
    body,
    originalUrl,
    header: (name: string) => (name === 'X-Twilio-Signature' ? signature : undefined),
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: '',
    typeValue: '',
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type(t: string) {
      this.typeValue = t;
      return this;
    },
    send(b: string) {
      this.body = b;
      return this;
    },
  };
  return res;
}

describe('TwilioSmsWebhookController', () => {
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

  it('rejects when Twilio is not configured', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const comms = { applyInboundSmsKeyword: jest.fn() };
    const prisma = { phoneNumber: { findFirst: jest.fn() } };
    const controller = new TwilioSmsWebhookController(comms as any, prisma as any);
    const req = makeReq({ From: '+1', To: '+2', Body: 'STOP' }, '/api/v1/comms/webhooks/twilio/sms-inbound', 'sig');
    const res = makeRes();

    await expect(controller.handleInboundSms(req, res, 't1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(comms.applyInboundSmsKeyword).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures', async () => {
    validateRequest.mockReturnValue(false);
    const comms = { applyInboundSmsKeyword: jest.fn() };
    const prisma = { phoneNumber: { findFirst: jest.fn() } };
    const controller = new TwilioSmsWebhookController(comms as any, prisma as any);
    const req = makeReq(
      { From: '+15551230099', To: '+15551110000', Body: 'STOP' },
      '/api/v1/comms/webhooks/twilio/sms-inbound?tenantId=t1',
      'bad',
    );
    const res = makeRes();

    await expect(controller.handleInboundSms(req, res, 't1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(comms.applyInboundSmsKeyword).not.toHaveBeenCalled();
  });

  it('applies STOP keyword and returns TwiML confirmation', async () => {
    validateRequest.mockReturnValue(true);
    const comms = { applyInboundSmsKeyword: jest.fn().mockResolvedValue({ handled: true, action: 'opt_out' }) };
    const prisma = { phoneNumber: { findFirst: jest.fn() } };
    const controller = new TwilioSmsWebhookController(comms as any, prisma as any);
    const req = makeReq(
      { From: '+15551230099', To: '+15551110000', Body: 'STOP' },
      '/api/v1/comms/webhooks/twilio/sms-inbound?tenantId=tenant_demo',
      'good',
    );
    const res = makeRes();

    await controller.handleInboundSms(req, res, 'tenant_demo');

    expect(comms.applyInboundSmsKeyword).toHaveBeenCalledWith(
      'tenant_demo',
      '+15551230099',
      'STOP',
    );
    expect(res.statusCode).toBe(200);
    expect(res.typeValue).toBe('text/xml');
    expect(res.body).toContain('unsubscribed');
  });

  it('rejects missing From/To even with valid signature', async () => {
    validateRequest.mockReturnValue(true);
    const comms = { applyInboundSmsKeyword: jest.fn() };
    const prisma = { phoneNumber: { findFirst: jest.fn() } };
    const controller = new TwilioSmsWebhookController(comms as any, prisma as any);
    const req = makeReq({ Body: 'STOP' }, '/api/v1/comms/webhooks/twilio/sms-inbound?tenantId=t1', 'sig');
    const res = makeRes();

    await expect(controller.handleInboundSms(req, res, 't1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
