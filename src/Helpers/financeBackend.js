// Backend-mode data source for the Finance pages (VITE_BACKEND_FINANCE_MODE=true).
// The Finance UI was built against the mock layer's shape — company and
// people as names — so this maps the backend's related records and
// membership ids onto it.
import * as api from "./backendFinanceClient";
import { orgId, ownersMap, listAll } from "./crmBackendCommon";

export const BACKEND_ENABLED = api.BACKEND_FINANCE_MODE_ENABLED;

const nameOf = (ownersById, membershipId) => (membershipId ? ownersById.get(membershipId)?.name || "Member" : null);

export function toUiInvoice(invoice, ownersById = new Map()) {
  if (!invoice) return invoice;
  return {
    ...invoice,
    companyName: invoice.company?.name || "",
    approvedBy: nameOf(ownersById, invoice.approvedByMembershipId),
    payments: (invoice.payments || []).map((p) => ({ _id: p._id, amount: p.amount, method: p.method, date: p.date, reference: p.reference || null })),
  };
}

export function toUiExpense(expense, ownersById = new Map()) {
  if (!expense) return expense;
  return {
    ...expense,
    submittedBy: nameOf(ownersById, expense.submittedByMembershipId) || "Member",
    reviewedBy: nameOf(ownersById, expense.reviewedByMembershipId),
  };
}

// Only the fields the backend accepts — never names or totals.
export function toApiInvoice(payload = {}) {
  const out = {};
  for (const f of ["companyId", "dealId", "currency", "dueDate"]) if (f in payload) out[f] = payload[f] || null;
  out.items = (payload.items || []).map(({ name, qty, unitPrice, taxCategory }) => ({ name, qty, unitPrice, ...(taxCategory && { taxCategory }) }));
  return out;
}

export function toApiExpense(payload = {}) {
  const out = {};
  for (const f of ["description", "category", "amount", "date", "currency"]) if (f in payload && payload[f] !== "") out[f] = payload[f];
  return out;
}

async function withOwners(promise, map) {
  const [data, owners] = await Promise.all([promise, ownersMap()]);
  return map(data, owners);
}

export const listInvoices = () =>
  withOwners(
    listAll(async (page, pageSize) => {
      const { invoices, total } = await api.listInvoices(orgId(), { page, pageSize });
      return { items: invoices || [], total };
    }),
    (items, owners) => items.map((i) => toUiInvoice(i, owners)),
  );
export const getInvoice = (id) => withOwners(api.getInvoice(orgId(), id), ({ invoice }, owners) => toUiInvoice(invoice, owners));
export const createInvoice = (payload) => withOwners(api.createInvoice(orgId(), toApiInvoice(payload)), ({ invoice }, owners) => toUiInvoice(invoice, owners));
export const approveInvoice = (id) => withOwners(api.approveInvoice(orgId(), id), ({ invoice }, owners) => toUiInvoice(invoice, owners));
export const sendInvoice = (id) => withOwners(api.sendInvoice(orgId(), id), ({ invoice }, owners) => toUiInvoice(invoice, owners));
export const voidInvoice = (id, reason) => withOwners(api.voidInvoice(orgId(), id, reason), ({ invoice }, owners) => toUiInvoice(invoice, owners));
export const recordPayment = (id, amount, method) => withOwners(api.recordPayment(orgId(), id, { amount, method }), ({ invoice }, owners) => toUiInvoice(invoice, owners));
export const createInvoiceFromOrder = (orderId) => withOwners(api.requestOrderInvoice(orgId(), orderId), ({ invoice }, owners) => toUiInvoice(invoice, owners));

export const listCreditNotes = () => api.listCreditNotes(orgId()).then(({ creditNotes }) => creditNotes || []);
// → { creditNote, invoice } like the mock layer.
export const issueCreditNote = ({ invoiceId, amount, reason }) =>
  withOwners(api.issueCreditNote(orgId(), { invoiceId, amount, reason }), ({ creditNote, invoice }, owners) => ({ creditNote, invoice: toUiInvoice(invoice, owners) }));

export const listExpenses = () =>
  withOwners(
    listAll(async (page, pageSize) => {
      const { expenses, total } = await api.listExpenses(orgId(), { page, pageSize });
      return { items: expenses || [], total };
    }),
    (items, owners) => items.map((e) => toUiExpense(e, owners)),
  );
export const createExpense = (payload) => withOwners(api.createExpense(orgId(), toApiExpense(payload)), ({ expense }, owners) => toUiExpense(expense, owners));
export const reviewExpense = (id, status) => withOwners(api.reviewExpense(orgId(), id, status), ({ expense }, owners) => toUiExpense(expense, owners));

export const listRecurringInvoices = () => api.listRecurringInvoices(orgId()).then(({ recurringInvoices }) => recurringInvoices || []);
export const createRecurringInvoice = ({ companyId, interval, items }) =>
  api.createRecurringInvoice(orgId(), { companyId, interval, items }).then(({ recurringInvoice }) => recurringInvoice);
export const toggleRecurringInvoice = (id, active) => api.updateRecurringInvoice(orgId(), id, { active }).then(({ recurringInvoice }) => recurringInvoice);
// → { recurringInvoice, invoice } like the mock layer.
export const generateNextInvoice = (id) =>
  withOwners(api.generateRecurringInvoice(orgId(), id), ({ recurringInvoice, invoice }, owners) => ({ recurringInvoice, invoice: toUiInvoice(invoice, owners) }));
