// Runs a Finance work-queue action (approve, post, reject…) against the
// backend. Posting-type steps send an Idempotency-Key so a double click or
// retry can never post twice. `body` carries reasons and choices.
import { financePost } from "./backendFinanceClient";

// [path, body transform, needs idempotency key]
const ROUTES = {
  journal: {
    submit: (i) => [`/finance/journals/${i.id}/submit`],
    approve: (i) => [`/finance/journals/${i.id}/approve`],
    post: (i) => [`/finance/journals/${i.id}/post`, {}, true],
    cancel: (i, b) => [`/finance/journals/${i.id}/cancel`, { reason: b.reason }],
  },
  invoice: {
    approve: (i) => [`/finance/invoices/${i.id}/approve`],
    post: (i) => [`/finance/invoices/${i.id}/post`, {}, true],
  },
  bill: {
    submit: (i) => [`/finance/bills/${i.id}/submit`],
    approve: (i) => [`/finance/bills/${i.id}/approve`],
    post: (i) => [`/finance/bills/${i.id}/post`, {}, true],
  },
  payment: {
    approve: (i) => [`/finance/payments/${i.id}/approve`],
    post: (i) => [`/finance/payments/${i.id}/post`, {}, true],
    cancel: (i, b) => [`/finance/payments/${i.id}/cancel`, { reason: b.reason }],
  },
  creditNote: {
    approve: (i) => [`/finance/credit-notes/${i.id}/approve`],
    post: (i) => [`/finance/credit-notes/${i.id}/post`, {}, true],
    cancel: (i, b) => [`/finance/credit-notes/${i.id}/cancel`, { reason: b.reason }],
  },
  expense: {
    approve: (i) => [`/finance/expenses/${i.id}/review`, { status: "Approved" }],
    reject: (i, b) => [`/finance/expenses/${i.id}/review`, { status: "Rejected", note: b.reason }],
    post: (i) => [`/finance/expenses/${i.id}/post`, {}, true],
    reimburse: (i, b) => [`/finance/expenses/${i.id}/reimburse`, { financialAccountId: b.financialAccountId }, true],
  },
  expenseReport: {
    approve: (i) => [`/finance/expense-reports/${i.id}/approve`],
    reject: (i, b) => [`/finance/expense-reports/${i.id}/reject`, { reason: b.reason }],
    post: (i) => [`/finance/expense-reports/${i.id}/post`, {}, true],
    reimburse: (i, b) => [`/finance/expense-reports/${i.id}/reimburse`, { financialAccountId: b.financialAccountId }, true],
  },
  budgetVersion: {
    approve: (i) => [`/finance/budgets/${i.budgetId}/versions/${i.id}/approve`],
    reject: (i, b) => [`/finance/budgets/${i.budgetId}/versions/${i.id}/reject`, { reason: b.reason }],
    activate: (i) => [`/finance/budgets/${i.budgetId}/versions/${i.id}/activate`, {}, true],
  },
  reconciliation: {
    complete: (i) => [`/finance/reconciliations/${i.id}/complete`, {}, true],
  },
};

// Actions that need the person to say why.
export const NEEDS_REASON = new Set(["reject", "cancel"]);
export const NEEDS_FINANCIAL_ACCOUNT = new Set(["reimburse"]);

export async function runQueueAction(organizationId, item, action, body = {}) {
  const route = ROUTES[item.kind]?.[action];
  if (!route) throw new Error(`"${action}" isn't available for this record.`);
  const [path, payload = {}, idempotent] = route(item, body);
  if (body.overrideReason) payload.overrideReason = body.overrideReason;
  const data = await financePost(path, organizationId, payload, idempotent);
  return data;
}

export const errorText = (error, fallback = "Something went wrong.") => error?.response?.data?.message || error?.message || fallback;
export const errorCode = (error) => error?.response?.data?.code || null;
