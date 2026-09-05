import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

let contractCounter = 1000;

function activityEntry(type, actor, description) {
  return { _id: crypto.randomUUID(), type, actor, at: new Date().toISOString(), description };
}

function lineItemsCreateData(lineItems = []) {
  return lineItems.map((l, i) => ({
    catalogItemId: l.catalogItemId || null, isCustomLine: !l.catalogItemId, name: l.name, description: l.description || "",
    unit: l.unit || "Each", billingModel: l.billingModel || "One Time", billingInterval: l.billingInterval || null,
    quantity: Number(l.quantity) || 1, listPriceSnapshot: l.listPriceSnapshot ?? null, priceBookIdUsed: l.priceBookIdUsed || null,
    priceBookPriceSnapshot: l.priceBookPriceSnapshot ?? null, unitPrice: Number(l.unitPrice) || 0,
    discountType: l.discountType || null, discountValue: l.discountValue ?? null, taxCategory: l.taxCategory || "Standard", order: i,
  }));
}

const include = { company: true, contact: true, deal: true, sourceQuote: true, sourceOrder: true, lineItems: true };

function deriveContractType(lineItems) {
  return lineItems.some((l) => l.billingModel === "Recurring") ? "Subscription / Recurring Service Agreement" : "One-Time Agreement";
}

export async function list(req, res) {
  const { search, status, companyId, sourceQuoteId, sourceOrderId, archived } = req.query;
  const where = {};
  if (archived !== undefined) where.archived = archived === "true";
  if (status) where.status = status;
  if (companyId) where.companyId = companyId;
  if (sourceQuoteId) where.sourceQuoteId = sourceQuoteId;
  if (sourceOrderId) where.sourceOrderId = sourceOrderId;
  if (search) where.contractNumber = { contains: search, mode: "insensitive" };
  const contracts = await prisma.contract.findMany({ where, include, orderBy: { updatedAt: "desc" } });
  res.json({ contracts: toApi(contracts) });
}

export async function getOne(req, res) {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id }, include });
  if (!contract) return res.status(404).json({ message: "Contract not found" });
  res.json({ contract: toApi(contract) });
}

export async function create(req, res) {
  const { lineItems = [], ...rest } = req.body;
  const contract = await prisma.contract.create({
    data: {
      ...rest, contractNumber: `CTR-PREVIEW-${++contractCounter}`, contractType: rest.contractType || deriveContractType(lineItems),
      activityLog: [activityEntry("created", req.user.name, "Contract created")],
      lineItems: { create: lineItemsCreateData(lineItems) },
    },
    include,
  });
  res.status(201).json({ contract: toApi(contract) });
}

export async function update(req, res) {
  const { lineItems, ...rest } = req.body;
  if (lineItems) {
    await prisma.contractLineItem.deleteMany({ where: { contractId: req.params.id } });
    await prisma.contractLineItem.createMany({ data: lineItemsCreateData(lineItems).map((l) => ({ ...l, contractId: req.params.id })) });
  }
  const contract = await prisma.contract.update({ where: { id: req.params.id }, data: rest, include });
  res.json({ contract: toApi(contract) });
}

export async function submitForInternalReview(req, res) {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) return res.status(404).json({ message: "Contract not found" });
  const activityLog = [...(contract.activityLog || []), activityEntry("review_submitted", req.user.name, "Submitted for internal review")];
  const updated = await prisma.contract.update({ where: { id: req.params.id }, data: { status: "Pending Internal Review", activityLog }, include });
  res.json({ contract: toApi(updated) });
}

export async function sendForSignature(req, res) {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) return res.status(404).json({ message: "Contract not found" });
  const activityLog = [...(contract.activityLog || []), activityEntry("sent_for_signature", req.user.name, "Sent for signature")];
  const updated = await prisma.contract.update({ where: { id: req.params.id }, data: { status: "Sent for Signature", sentForSignatureAt: new Date(), activityLog }, include });
  res.json({ contract: toApi(updated) });
}

// Recording one party's signature; once BOTH internal and customer
// signatories are present, the contract auto-promotes to "Signed".
export async function recordSignature(req, res) {
  const { party, name, title } = req.body;
  if (!party || !["internal", "customer"].includes(party)) return res.status(400).json({ message: "party must be 'internal' or 'customer'" });
  if (!name?.trim()) return res.status(400).json({ message: "A signatory name is required" });

  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) return res.status(404).json({ message: "Contract not found" });

  const signedAt = new Date();
  const data = party === "internal"
    ? { internalSignatoryName: name, internalSignatoryTitle: title || null, internalSignedAt: signedAt }
    : { customerSignatoryName: name, customerSignatoryTitle: title || null, customerSignedAt: signedAt };

  const otherSigned = party === "internal" ? contract.customerSignedAt : contract.internalSignedAt;
  const activityLog = [...(contract.activityLog || []), activityEntry("signature_recorded", req.user.name, `${party === "internal" ? "Internal" : "Customer"} signature recorded: ${name}`)];
  if (otherSigned) {
    data.status = "Signed";
    data.signedAt = signedAt;
    activityLog.push(activityEntry("signed", req.user.name, "Contract fully executed — both parties have signed"));
  }
  data.activityLog = activityLog;

  const updated = await prisma.contract.update({ where: { id: req.params.id }, data, include });
  res.json({ contract: toApi(updated) });
}

export async function renewContract(req, res) {
  const { newEndDate, note } = req.body;
  if (!newEndDate) return res.status(400).json({ message: "A new end date is required to renew" });
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract || contract.status !== "Signed") return res.status(404).json({ message: "Contract not found, or it isn't Signed yet" });

  const amendmentHistory = [...(contract.amendmentHistory || []), {
    _id: crypto.randomUUID(), at: new Date().toISOString(), actor: req.user.name, note: note || "",
    previousEndDate: contract.endDate, newEndDate,
  }];
  const activityLog = [...(contract.activityLog || []), activityEntry("renewed", req.user.name, `Renewed through ${new Date(newEndDate).toLocaleDateString()}${note ? `: ${note}` : ""}`)];
  const updated = await prisma.contract.update({ where: { id: req.params.id }, data: { endDate: new Date(newEndDate), amendmentHistory, activityLog }, include });
  res.json({ contract: toApi(updated) });
}

export async function terminateContract(req, res) {
  const { reason, effectiveDate } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A termination reason is required" });
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) return res.status(404).json({ message: "Contract not found" });
  const activityLog = [...(contract.activityLog || []), activityEntry("terminated", req.user.name, `Terminated: ${reason}`)];
  const updated = await prisma.contract.update({ where: { id: req.params.id }, data: { status: "Terminated", terminationReason: reason, terminationEffectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(), activityLog }, include });
  res.json({ contract: toApi(updated) });
}

export async function cancelContract(req, res) {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A cancellation reason is required" });
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract || !["Draft", "Pending Internal Review", "Sent for Signature"].includes(contract.status)) {
    return res.status(400).json({ message: "Only a Draft, Pending Internal Review or Sent for Signature Contract can be cancelled" });
  }
  const activityLog = [...(contract.activityLog || []), activityEntry("cancelled", req.user.name, `Cancelled: ${reason}`)];
  const updated = await prisma.contract.update({ where: { id: req.params.id }, data: { status: "Cancelled", cancellationReason: reason, activityLog }, include });
  res.json({ contract: toApi(updated) });
}

export async function expireContract(req, res) {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) return res.status(404).json({ message: "Contract not found" });
  const activityLog = [...(contract.activityLog || []), activityEntry("expired", req.user.name, "Marked expired")];
  const updated = await prisma.contract.update({ where: { id: req.params.id }, data: { status: "Expired", activityLog }, include });
  res.json({ contract: toApi(updated) });
}

export async function archiveContract(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ message: "A reason is required to archive a Contract" });
  const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
  const contract = await prisma.contract.update({ where: { id: req.params.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status } });
  res.json({ contract: toApi(contract) });
}
export async function restoreContract(req, res) {
  const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
  const contract = await prisma.contract.update({ where: { id: req.params.id }, data: { archived: false, archiveReason: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null } });
  res.json({ contract: toApi(contract) });
}
export async function bulkAssign(req, res) {
  const { ids, ownerId } = req.body;
  await prisma.contract.updateMany({ where: { id: { in: ids || [] } }, data: { ownerId } });
  res.json({ contracts: toApi(await prisma.contract.findMany({ where: { id: { in: ids || [] } } })) });
}
export async function bulkArchive(req, res) {
  const { ids, reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A reason is required" });
  await prisma.contract.updateMany({ where: { id: { in: ids || [] } }, data: { archived: true, archiveReason: reason, archivedAt: new Date() } });
  res.json({ contracts: toApi(await prisma.contract.findMany({ where: { id: { in: ids || [] } } })) });
}
