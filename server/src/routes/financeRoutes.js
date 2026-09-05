import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

const router = Router();
router.use(authenticate);

let invoiceCounter = 1000;
let creditNoteCounter = 100;
let expenseCounter = 100;
const TAX_RATE = 0.08;

function statusForInvoice(invoice) {
  if (["Draft", "Void"].includes(invoice.status)) return invoice.status;
  if (invoice.amountPaid >= invoice.total) return "Paid";
  if (invoice.amountPaid > 0) return "Partially Paid";
  if (invoice.dueDate && new Date(invoice.dueDate) < new Date()) return "Overdue";
  return "Approved";
}

// --- Invoices ---
router.get("/invoices", asyncHandler(async (req, res) => {
  const { companyId, status } = req.query;
  const where = {};
  if (companyId) where.companyId = companyId;
  const invoices = await prisma.invoice.findMany({ where, include: { company: true, payments: true }, orderBy: { issueDate: "desc" } });
  const withStatus = invoices.map((inv) => ({ ...inv, status: statusForInvoice(inv) })).filter((inv) => !status || inv.status === status);
  res.json({ invoices: toApi(withStatus) });
}));
router.get("/invoices/:id", asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { company: true, payments: true, creditNotes: true } });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  res.json({ invoice: toApi({ ...invoice, status: statusForInvoice(invoice) }) });
}));
router.post("/invoices", asyncHandler(async (req, res) => {
  const items = req.body.items || [];
  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 1) * (Number(it.unitPrice) || 0), 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;
  const invoice = await prisma.invoice.create({
    data: { ...req.body, invoiceNumber: `INV-${++invoiceCounter}`, items, subtotal, tax, total, amountDue: total, status: req.body.status || "Draft" },
  });
  res.status(201).json({ invoice: toApi(invoice) });
}));
router.put("/invoices/:id", requireRole("Super-Admin", "Admin", "Checker"), asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.update({ where: { id: req.params.id }, data: req.body });
  res.json({ invoice: toApi(invoice) });
}));
router.post("/invoices/:id/payments", requireRole("Super-Admin", "Admin", "Checker"), asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  const amount = Number(req.body.amount) || 0;
  await prisma.payment.create({ data: { invoiceId: invoice.id, amount, method: req.body.method || "Bank Transfer" } });
  const amountPaid = invoice.amountPaid + amount;
  const updated = await prisma.invoice.update({
    where: { id: req.params.id },
    data: { amountPaid, amountDue: Math.max(0, invoice.total - amountPaid) },
    include: { payments: true },
  });
  res.json({ invoice: toApi({ ...updated, status: statusForInvoice(updated) }) });
}));

// --- Credit Notes ---
router.get("/credit-notes", asyncHandler(async (req, res) => {
  const creditNotes = await prisma.creditNote.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ creditNotes: toApi(creditNotes) });
}));
router.post("/credit-notes", asyncHandler(async (req, res) => {
  const creditNote = await prisma.creditNote.create({ data: { ...req.body, creditNoteNumber: `CN-${++creditNoteCounter}` } });
  res.status(201).json({ creditNote: toApi(creditNote) });
}));

// --- Expenses ---
router.get("/expenses", asyncHandler(async (req, res) => {
  const expenses = await prisma.expense.findMany({ include: { submittedBy: true }, orderBy: { date: "desc" } });
  res.json({ expenses: toApi(expenses) });
}));
router.post("/expenses", asyncHandler(async (req, res) => {
  const expense = await prisma.expense.create({ data: { ...req.body, expenseNumber: `EXP-${++expenseCounter}`, submittedById: req.user.id } });
  res.status(201).json({ expense: toApi(expense) });
}));
router.put("/expenses/:id", requireRole("Super-Admin", "Admin", "Checker"), asyncHandler(async (req, res) => {
  // Separation of duties: a Finance/Checker approver must not be the same
  // person who submitted the expense.
  const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (req.body.status && ["Approved", "Rejected"].includes(req.body.status) && expense.submittedById === req.user.id) {
    return res.status(403).json({ message: "You cannot approve or reject your own expense submission" });
  }
  const updated = await prisma.expense.update({ where: { id: req.params.id }, data: { ...req.body, reviewedBy: req.user.name } });
  res.json({ expense: toApi(updated) });
}));

// --- Recurring Invoices ---
router.get("/recurring-invoices", asyncHandler(async (req, res) => {
  const recurringInvoices = await prisma.recurringInvoice.findMany({ include: { company: true }, orderBy: { createdAt: "desc" } });
  res.json({ recurringInvoices: toApi(recurringInvoices) });
}));
router.post("/recurring-invoices", asyncHandler(async (req, res) => {
  const recurringInvoice = await prisma.recurringInvoice.create({ data: req.body });
  res.status(201).json({ recurringInvoice: toApi(recurringInvoice) });
}));
router.put("/recurring-invoices/:id", asyncHandler(async (req, res) => {
  const recurringInvoice = await prisma.recurringInvoice.update({ where: { id: req.params.id }, data: req.body });
  res.json({ recurringInvoice: toApi(recurringInvoice) });
}));
router.post("/recurring-invoices/:id/generate", asyncHandler(async (req, res) => {
  const template = await prisma.recurringInvoice.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).json({ message: "Recurring invoice not found" });
  const items = template.items || [];
  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 1) * (Number(it.unitPrice) || 0), 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;
  const invoice = await prisma.invoice.create({
    data: { invoiceNumber: `INV-${++invoiceCounter}`, companyId: template.companyId, items, subtotal, tax, total, amountDue: total, status: "Draft" },
  });
  await prisma.recurringInvoice.update({
    where: { id: req.params.id },
    data: { lastGeneratedAt: new Date(), invoicesGenerated: template.invoicesGenerated + 1 },
  });
  res.status(201).json({ invoice: toApi(invoice) });
}));

export default router;
