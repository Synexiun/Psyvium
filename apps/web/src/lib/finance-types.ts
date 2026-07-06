/**
 * Local response types for the Finance endpoints (Payments 24 / Accounting 25 /
 * Payouts 26). Mirror the shared backend contract exactly; kept local to apps/web.
 *
 * MONEY is transported as STRINGS (Decimal(18,4) serialized) to preserve
 * precision — never parse to a JS number for math; format for display only.
 *
 * Endpoints:
 *   GET   /finance/summary            → FinanceSummaryDto
 *   POST  /finance/invoices           → InvoiceDto
 *   GET   /finance/invoices           → InvoiceDto[]
 *   POST  /finance/invoices/:id/pay   → PaymentDto
 *   GET   /finance/ledger             → LedgerEntryDto[]
 *   POST  /finance/payouts/compute    → PayoutDto
 *   GET   /finance/payouts            → PayoutDto[]
 */

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'REFUNDED' | 'VOID';
export type PayoutStatus = 'PENDING' | 'COMPUTED' | 'RELEASED' | 'FAILED';

export interface InvoiceLineDto {
  description: string;
  amount: string;
}
export interface InvoiceDto {
  id: string;
  clientId: string;
  clientName: string;
  amount: string;
  currency: string;
  status: InvoiceStatus;
  lineItems: InvoiceLineDto[];
  dueDate: string | null;
  createdAt: string;
}
export interface PaymentDto {
  id: string;
  invoiceId: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  capturedAt: string | null;
}
export interface LedgerEntryDto {
  id: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  memo: string | null;
  postedAt: string;
}
export interface PayoutDto {
  id: string;
  psychologistId: string;
  psychologistName: string;
  periodStart: string;
  periodEnd: string;
  computedAmount: string;
  currency: string;
  status: PayoutStatus;
  createdAt: string;
}
export interface FinanceSummaryDto {
  currency: string;
  openInvoiceCount: number;
  paidTotal: string;
  outstandingTotal: string;
  payoutsPendingTotal: string;
}

/* ── Request payloads ─────────────────────────────────────────────────── */
export interface CreateInvoiceInput {
  clientId: string;
  lineItems: InvoiceLineDto[];
  currency?: string;
  dueDate?: string;
}
export interface ComputePayoutInput {
  psychologistId: string;
  periodStart: string;
  periodEnd: string;
}
