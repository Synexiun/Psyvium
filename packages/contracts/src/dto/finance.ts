import { z } from 'zod';
import { InvoiceStatus, PayoutStatus } from '../enums';

/**
 * Finance DTOs (`docs/technical/13-roadmap-and-phases.md`, contexts 24/25/26,
 * Phase 6 — "Money handled with NUMERIC, atomic writes, reconciliation, and
 * audit"). This is the SHARED CONTRACT the web cockpit is built against.
 *
 * All money crosses the wire as a **decimal string** (never a JS number) so
 * precision survives serialization; the server always computes with
 * `Prisma.Decimal`. Timestamps are UTC ISO-8601 strings.
 */

/** A decimal-string money field: digits, optional sign, optional fractional part. */
const moneyString = z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');

// ── Read models ──

export const invoiceLineSchema = z.object({
  description: z.string(),
  amount: moneyString,
});
export type InvoiceLineDto = z.infer<typeof invoiceLineSchema>;

export const invoiceSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  amount: moneyString,
  currency: z.string(),
  status: z.nativeEnum(InvoiceStatus),
  lineItems: z.array(invoiceLineSchema),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
});
export type InvoiceDto = z.infer<typeof invoiceSchema>;

export const paymentSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  amount: moneyString,
  currency: z.string(),
  method: z.string(),
  status: z.string(),
  capturedAt: z.string().nullable(),
});
export type PaymentDto = z.infer<typeof paymentSchema>;

export const ledgerEntrySchema = z.object({
  id: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  debit: moneyString,
  credit: moneyString,
  memo: z.string().nullable(),
  postedAt: z.string(),
});
export type LedgerEntryDto = z.infer<typeof ledgerEntrySchema>;

export const payoutSchema = z.object({
  id: z.string(),
  psychologistId: z.string(),
  psychologistName: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  computedAmount: moneyString,
  currency: z.string(),
  status: z.nativeEnum(PayoutStatus),
  /** Dual-control fields (audit G2): approver must differ from computer. */
  computedBy: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  decisionNote: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type PayoutDto = z.infer<typeof payoutSchema>;

/**
 * COMPUTED → APPROVED | REJECTED. Approval is the dual-control disbursement
 * gate — a payout can only be disbursed (once a bank-rail adapter exists)
 * after a DIFFERENT user than the one who computed it has approved it.
 * A rejection note is required so the statement trail explains itself.
 */
export const decidePayoutSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'REJECTED' && !value.note?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'A note explaining the rejection is required',
      });
    }
  });
export type DecidePayoutInput = z.infer<typeof decidePayoutSchema>;

export const financeSummarySchema = z.object({
  currency: z.string(),
  openInvoiceCount: z.number(),
  paidTotal: moneyString,
  outstandingTotal: moneyString,
  payoutsPendingTotal: moneyString,
});
export type FinanceSummaryDto = z.infer<typeof financeSummarySchema>;

// ── Write models ──

export const createInvoiceLineSchema = z.object({
  description: z.string().min(1),
  amount: moneyString,
});

export const createInvoiceSchema = z.object({
  clientId: z.string().min(1),
  lineItems: z.array(createInvoiceLineSchema).min(1),
  currency: z.string().default('USD'),
  dueDate: z.string().datetime().optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const payInvoiceSchema = z.object({
  method: z.string().default('card'),
});
export type PayInvoiceInput = z.infer<typeof payInvoiceSchema>;

/** Refund request — reason is required for the critical audit trail. */
export const requestRefundSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type RequestRefundInput = z.infer<typeof requestRefundSchema>;

export const computePayoutSchema = z.object({
  psychologistId: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type ComputePayoutInput = z.infer<typeof computePayoutSchema>;
