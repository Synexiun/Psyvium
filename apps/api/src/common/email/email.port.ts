/**
 * Transactional email port (password reset, invite, DPO alerts).
 * Activate-on-key: real providers only when credentials are present.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain-text body only — never put unredacted PHI in email when avoidable. */
  text: string;
  /** Optional HTML twin (providers that support it). */
  html?: string;
  tags?: string[];
}

export interface SendEmailResult {
  delivered: boolean;
  provider: 'console' | 'resend' | 'smtp';
  providerRef?: string;
  reason?: string;
}

export interface EmailProvider {
  readonly name: SendEmailResult['provider'];
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
