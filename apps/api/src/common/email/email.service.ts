import { Injectable, Logger } from '@nestjs/common';
import { ConsoleEmailAdapter } from './console-email.adapter';
import type { EmailProvider, SendEmailInput, SendEmailResult } from './email.port';
import { ResendEmailAdapter } from './resend-email.adapter';

/**
 * Transactional email facade. Provider selection is activate-on-key:
 *   RESEND_API_KEY + EMAIL_FROM → Resend
 *   else → console (honest non-delivery)
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly provider: EmailProvider;

  constructor() {
    const resend = ResendEmailAdapter.fromEnv();
    if (resend) {
      this.provider = resend;
      this.logger.log('Email provider: Resend (live).');
    } else {
      this.provider = new ConsoleEmailAdapter();
      this.logger.warn(
        'Email provider: console (set RESEND_API_KEY + EMAIL_FROM for live delivery).',
      );
    }
  }

  get isLive(): boolean {
    return this.provider.name !== 'console';
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    return this.provider.send(input);
  }

  /** Password-reset deep link email. */
  async sendPasswordReset(to: string, resetUrl: string): Promise<SendEmailResult> {
    return this.send({
      to,
      subject: 'Reset your VPSY / Psyvium password',
      text:
        `You requested a password reset.\n\n` +
        `Open this link within 1 hour:\n${resetUrl}\n\n` +
        `If you did not request this, ignore this email. Never share the link.`,
      tags: ['password-reset'],
    });
  }

  /** Staff invite activation email. */
  async sendInvite(to: string, inviteUrl: string, fullName: string): Promise<SendEmailResult> {
    return this.send({
      to,
      subject: 'You are invited to VPSY / Psyvium',
      text:
        `Hello ${fullName},\n\n` +
        `An administrator invited you to the clinical platform.\n` +
        `Activate your account:\n${inviteUrl}\n\n` +
        `This link expires in 7 days.`,
      tags: ['invite'],
    });
  }

  /** DPO / security alert (no free-text PHI beyond ids). */
  async sendSecurityAlert(
    to: string,
    alert: { title: string; summary: string; tenantId: string },
  ): Promise<SendEmailResult> {
    return this.send({
      to,
      subject: `[VPSY SECURITY] ${alert.title}`,
      text:
        `${alert.title}\n\n` +
        `Tenant: ${alert.tenantId}\n` +
        `${alert.summary}\n\n` +
        `Review the audit trail in the admin console. Do not reply to this address.`,
      tags: ['security-alert', 'dpo'],
    });
  }
}
