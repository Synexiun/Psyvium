import { EmailService } from './email.service';

describe('EmailService', () => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.EMAIL_FROM;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = prevFrom;
  });

  it('uses console provider when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const svc = new EmailService();
    expect(svc.isLive).toBe(false);
    const result = await svc.sendPasswordReset('user@example.com', 'https://app/reset?t=abc');
    expect(result.provider).toBe('console');
    expect(result.delivered).toBe(false);
  });
});
