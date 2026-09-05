// In-memory mock Finance "database" — same pattern as the other mock*Data files.
import { faker } from "@faker-js/faker";
import { companies } from "./mockCrmData";

const id = () => faker.database.mongodbObjectId();
let invoiceCounter = 8000;
let creditNoteCounter = 300;
let expenseCounter = 100;

const TAX_RATE = 0.08; // flat 8% — kept simple per "don't build a full accounting platform"

export const invoices = [];
export const creditNotes = [];
export const expenses = [];
export const recurringInvoices = [];

function computeInvoiceTotals(items) {
  const subtotal = (items || []).reduce((sum, i) => sum + (i.qty || 1) * (i.unitPrice || 0), 0);
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}

function statusForInvoice(invoice) {
  if (invoice.status === "Void") return "Void";
  if (invoice.amountPaid >= invoice.total) return "Paid";
  if (invoice.amountPaid > 0) return "Partially Paid";
  if (["Draft", "Approved"].includes(invoice.status)) return invoice.status;
  if (new Date(invoice.dueDate) < new Date()) return "Overdue";
  return invoice.status;
}

export function createInvoiceRecord(payload) {
  const { subtotal, tax, total } = computeInvoiceTotals(payload.items);
  const invoice = {
    _id: id(),
    invoiceNumber: `INV-${++invoiceCounter}`,
    orderId: payload.orderId || null,
    dealId: payload.dealId || null,
    companyId: payload.companyId,
    companyName: payload.companyName,
    items: payload.items || [],
    currency: payload.currency || "USD",
    subtotal,
    tax,
    total,
    amountPaid: 0,
    amountDue: total,
    payments: [],
    status: "Draft",
    approvedBy: null,
    voidReason: null,
    issueDate: new Date().toISOString(),
    dueDate: payload.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  invoices.unshift(invoice);
  return invoice;
}

export function findInvoice(invoiceId) {
  return invoices.find((i) => i._id === invoiceId);
}

export function updateInvoiceRecord(invoiceId, changes) {
  const invoice = findInvoice(invoiceId);
  if (!invoice) return null;
  Object.assign(invoice, changes);
  invoice.status = statusForInvoice(invoice);
  return invoice;
}

export function recordPaymentRecord(invoiceId, amount, method) {
  const invoice = findInvoice(invoiceId);
  if (!invoice) return null;
  invoice.payments.push({ amount: Number(amount), method: method || "Bank Transfer", date: new Date().toISOString() });
  invoice.amountPaid = Math.round((invoice.amountPaid + Number(amount)) * 100) / 100;
  invoice.amountDue = Math.max(0, Math.round((invoice.total - invoice.amountPaid) * 100) / 100);
  invoice.status = statusForInvoice(invoice);
  return invoice;
}

// Re-evaluate overdue status for every open invoice — called on each list
// fetch so due dates that have passed reflect "Overdue" without needing a
// background job.
export function refreshOverdueStatuses() {
  invoices.forEach((invoice) => {
    invoice.status = statusForInvoice(invoice);
  });
  return invoices;
}

// ---- Seed data ----
function seedInvoice({ bucket }) {
  const company = faker.helpers.arrayElement(companies);
  const items = faker.helpers.multiple(
    () => ({ name: faker.commerce.productName(), qty: faker.number.int({ min: 1, max: 5 }), unitPrice: faker.number.int({ min: 100, max: 3000 }) }),
    { count: faker.number.int({ min: 1, max: 3 }) }
  );
  const { subtotal, tax, total } = computeInvoiceTotals(items);
  const issueDate = faker.date.recent({ days: 45 });

  const base = {
    _id: id(),
    invoiceNumber: `INV-${++invoiceCounter}`,
    orderId: null,
    dealId: null,
    companyId: company._id,
    companyName: company.name,
    items,
    currency: "USD",
    subtotal,
    tax,
    total,
    payments: [],
    voidReason: null,
    approvedBy: null,
    issueDate: issueDate.toISOString(),
    createdAt: issueDate.toISOString(),
  };

  if (bucket === "paid") {
    return { ...base, status: "Paid", amountPaid: total, amountDue: 0, dueDate: faker.date.recent({ days: 10, refDate: new Date() }).toISOString(), payments: [{ amount: total, method: "Bank Transfer", date: issueDate.toISOString() }] };
  }
  if (bucket === "partial") {
    const paid = Math.round(total * 0.4 * 100) / 100;
    return { ...base, status: "Partially Paid", amountPaid: paid, amountDue: Math.round((total - paid) * 100) / 100, dueDate: faker.date.soon({ days: 15 }).toISOString(), payments: [{ amount: paid, method: "Credit Card", date: issueDate.toISOString() }] };
  }
  if (bucket === "overdue") {
    return { ...base, status: "Overdue", amountPaid: 0, amountDue: total, dueDate: faker.date.recent({ days: 15 }).toISOString() };
  }
  if (bucket === "draft") {
    return { ...base, status: "Draft", amountPaid: 0, amountDue: total, dueDate: faker.date.soon({ days: 30 }).toISOString() };
  }
  // "approved" — sent, awaiting payment, not yet due
  return { ...base, status: "Approved", amountPaid: 0, amountDue: total, dueDate: faker.date.soon({ days: 20 }).toISOString() };
}

invoices.push(
  ...faker.helpers.multiple(
    () => seedInvoice({ bucket: faker.helpers.arrayElement(["paid", "paid", "partial", "overdue", "draft", "approved"]) }),
    { count: 12 }
  )
);

// Guarantee the Companies "unpaid invoices" fixture actually has one — the
// Company detail Finance tab is designed and tested against this specific
// company having a real overdue balance.
{
  const co = companies.find((c) => c.name === "Unpaid Invoices Retail Co");
  if (co) {
    const items = [{ name: "Annual Platform License", qty: 1, unitPrice: 18500 }];
    const { subtotal, tax, total } = computeInvoiceTotals(items);
    invoices.unshift({
      _id: id(), invoiceNumber: `INV-${++invoiceCounter}`, orderId: null, dealId: null,
      companyId: co._id, companyName: co.name, items, currency: "USD", subtotal, tax, total,
      status: "Overdue", amountPaid: 0, amountDue: total, payments: [], voidReason: null, approvedBy: null,
      issueDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }
}

// ---- Credit Notes ----
export function createCreditNoteRecord({ invoiceId, amount, reason }) {
  const invoice = findInvoice(invoiceId);
  if (!invoice) return null;
  const creditNote = {
    _id: id(),
    creditNoteNumber: `CN-${++creditNoteCounter}`,
    invoiceId,
    companyName: invoice.companyName,
    amount: Number(amount),
    reason,
    createdAt: new Date().toISOString(),
  };
  creditNotes.unshift(creditNote);
  invoice.amountDue = Math.max(0, Math.round((invoice.amountDue - Number(amount)) * 100) / 100);
  invoice.status = statusForInvoice(invoice);
  return { creditNote, invoice };
}

// ---- Expenses ----
function makeExpense(overrides = {}) {
  return {
    _id: id(),
    expenseNumber: `EXP-${++expenseCounter}`,
    description: faker.commerce.productName(),
    category: faker.helpers.arrayElement(["Travel", "Software", "Office Supplies", "Meals", "Other"]),
    amount: faker.number.int({ min: 20, max: 2000 }),
    submittedBy: faker.person.fullName(),
    status: faker.helpers.arrayElement(["Pending", "Approved", "Rejected"]),
    reviewedBy: null,
    date: faker.date.recent({ days: 30 }).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

expenses.push(...faker.helpers.multiple(() => makeExpense(), { count: 10 }));

export function createExpenseRecord(payload) {
  const expense = makeExpense({ ...payload, status: "Pending" });
  expenses.unshift(expense);
  return expense;
}

export function findExpense(expenseId) {
  return expenses.find((e) => e._id === expenseId);
}

export function updateExpenseRecord(expenseId, changes) {
  const expense = findExpense(expenseId);
  if (!expense) return null;
  Object.assign(expense, changes);
  return expense;
}

// ---- Recurring Invoices ----
export function createRecurringInvoiceRecord(payload) {
  const recurring = {
    _id: id(),
    companyId: payload.companyId,
    companyName: payload.companyName,
    items: payload.items || [],
    interval: payload.interval || "Monthly",
    active: true,
    lastGeneratedAt: null,
    invoicesGenerated: 0,
    createdAt: new Date().toISOString(),
  };
  recurringInvoices.unshift(recurring);
  return recurring;
}

export function findRecurringInvoice(recurringId) {
  return recurringInvoices.find((r) => r._id === recurringId);
}

export function updateRecurringInvoiceRecord(recurringId, changes) {
  const recurring = findRecurringInvoice(recurringId);
  if (!recurring) return null;
  Object.assign(recurring, changes);
  return recurring;
}

export function generateInvoiceFromRecurring(recurringId) {
  const recurring = findRecurringInvoice(recurringId);
  if (!recurring) return null;
  const invoice = createInvoiceRecord({
    companyId: recurring.companyId,
    companyName: recurring.companyName,
    items: recurring.items,
  });
  recurring.lastGeneratedAt = new Date().toISOString();
  recurring.invoicesGenerated = (recurring.invoicesGenerated || 0) + 1;
  return { recurringInvoice: recurring, invoice };
}
