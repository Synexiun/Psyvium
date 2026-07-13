import { Logger } from '@nestjs/common';
import type { EmailProvider, SendEmailInput, SendEmailResult } from './email.port';

/**
 * Honest dev/test adapter — logs a redacted envelope, never pretends mail left the box.
 */
export class ConsoleEmailAdapter implements EmailProvider {
  readonly name = 'console' as const;
  private readonly logger = new Logger(ConsoleEmailAdapter.name);

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.logger.warn(
      JSON.stringify({
        email: 'CONSOLE_ONLY',
        to: input.to.replace(/(^.).*(@.*$)/, '$1***$2'),
        subject: input.subject,
        tags: input.tags ?? [],
        bodyChars: input.text.length,
      }),
    );
    return { delivered: false, provider: 'console', reason: 'console-only' };
  }
}
