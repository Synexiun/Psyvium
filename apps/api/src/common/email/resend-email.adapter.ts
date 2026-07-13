import { Logger } from '@nestjs/common';
import type { EmailProvider, SendEmailInput, SendEmailResult } from './email.port';

/**
 * Resend HTTP adapter (activate-on-key: RESEND_API_KEY + EMAIL_FROM).
 * Uses global fetch — no extra npm dependency.
 */
export class ResendEmailAdapter implements EmailProvider {
  readonly name = 'resend' as const;
  private readonly logger = new Logger(ResendEmailAdapter.name);

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  static fromEnv(): ResendEmailAdapter | null {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim() || process.env.RESEND_FROM?.trim();
    if (!apiKey || !from) return null;
    return new ResendEmailAdapter(apiKey, from);
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          html: input.html,
          tags: (input.tags ?? []).map((name) => ({ name })),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Resend send failed status=${res.status}: ${body.slice(0, 200)}`);
        return { delivered: false, provider: 'resend', reason: `http-${res.status}` };
      }
      const json = (await res.json()) as { id?: string };
      return { delivered: true, provider: 'resend', providerRef: json.id };
    } catch (err) {
      this.logger.warn(`Resend send error: ${(err as Error).message}`);
      return { delivered: false, provider: 'resend', reason: (err as Error).message };
    }
  }
}
