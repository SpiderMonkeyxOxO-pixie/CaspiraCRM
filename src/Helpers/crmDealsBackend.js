// Backend-mode data source for the Deals and Pipeline pages
// (VITE_BACKEND_CRM_SALES_MODE=true). The Deals UI identifies pipelines and
// stages by name ("New Business", "Proposal"); the backend stores real
// Pipeline/PipelineStage records, so names are resolved against the
// organization's pipelines here. Every stage change goes through the
// backend's transition endpoints, which enforce the close-date/reason rules.
import * as sales from "./backendSalesClient";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "./backendCrmClient";
import { orgId, ownersMap, ownerFields, addNoteTo, listAll, notSupported } from "./crmBackendCommon";

export const BACKEND_ENABLED = BACKEND_CRM_SALES_MODE_ENABLED;

// --- Pipelines ---

let pipelinesPromise = null;

export function fetchPipelines() {
  pipelinesPromise ||= sales.listPipelines(orgId()).then((r) => r.pipelines || []).catch((error) => {
    pipelinesPromise = null;
    throw error;
  });
  return pipelinesPromise;
}

export function resetPipelinesCache() {
  pipelinesPromise = null;
}

function findPipeline(pipelines, nameOrId) {
  return pipelines.find((p) => p._id === nameOrId || p.name === nameOrId) || pipelines.find((p) => p.isDefault) || pipelines[0];
}

function findStage(pipeline, stageName) {
  return pipeline?.stages?.find((s) => s.name === stageName) || null;
}

// --- Shape translation ---

const RENAMED = {
  cancellationReason: "cancelReason",
  onHoldReason: "holdReason",
};

function toUiLineItem(item) {
  const discountPercent = item.discountType === "Percentage" ? Number(item.discountValue) || 0 : 0;
  const gross = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
  return {
    _id: item._id,
    productId: item.catalogItemId || null,
    name: item.nameSnapshot || "",
    sku: item.skuSnapshot || null,
    quantity: Number(item.quantity) || 0,
    unitPrice: Number(item.unitPrice) || 0,
    discountPercent,
    billingFrequency: item.billingFrequency || "One-time",
    lineTotal: gross - gross * (discountPercent / 100),
  };
}

function toUiQuote(quote) {
  return {
    _id: quote._id,
    quoteNumber: quote.quoteNumber,
    version: quote.version,
    amount: Number(quote.grandTotal) || 0,
    status: quote.status,
    createdAt: quote.createdAt,
    expirationDate: quote.validUntilDate || null,
  };
}

function toUiStageHistory(history, deal) {
  if (!history?.length) return [{ _id: `${deal._id}-created`, from: null, to: deal.stage, changedBy: "System", at: deal.createdAt, note: "Deal created" }];
  return history.map((h) => ({
    _id: h._id,
    from: h.fromStageName || null,
    to: h.toStageName,
    changedBy: "Member",
    at: h.changedAt,
    note: h.reason || null,
    timeInStagePriorMs: h.timeInPreviousStageSeconds != null ? h.timeInPreviousStageSeconds * 1000 : undefined,
  }));
}

export function toUiDeal(deal, { ownersById = new Map(), pipelines = [], stageHistory = null } = {}) {
  if (!deal) return deal;
  const ui = { ...deal };
  for (const [uiName, apiName] of Object.entries(RENAMED)) ui[uiName] = deal[apiName] ?? null;
  const value = Number(deal.value) || 0;
  const probability = Number(deal.probability) || 0;
  const lineItems = (deal.lineItems || []).map(toUiLineItem);
  const pipeline = pipelines.find((p) => p._id === deal.pipelineId);
  return {
    ...ui,
    ...ownerFields(deal, ownersById),
    pipeline: pipeline?.name || deal.pipelineRef?.name || deal.pipeline || null,
    handoffOwnerId: deal.handoffOwnerMembershipId || null,
    handoffOwnerName: ownersById.get(deal.handoffOwnerMembershipId)?.name || null,
    value,
    probability,
    weightedValue: (value * probability) / 100,
    expectedRecurringValue: lineItems.filter((i) => i.billingFrequency !== "One-time").reduce((sum, i) => sum + i.lineTotal, 0),
    additionalContactIds: Array.isArray(deal.additionalContactIds) ? deal.additionalContactIds : [],
    contactRoles: Array.isArray(deal.contactRoles) ? deal.contactRoles : [],
    competitors: Array.isArray(deal.competitors) ? deal.competitors : [],
    tags: Array.isArray(deal.tags) ? deal.tags : [],
    lineItems,
    quotes: (deal.quotes || []).map(toUiQuote),
    files: Array.isArray(deal.files) ? deal.files : [],
    stageHistory: stageHistory ? toUiStageHistory(stageHistory, deal) : toUiStageHistory([], deal),
    auditLog: [],
  };
}

// UI form payload → API fields. Pipeline/stage/status are never sent here;
// they move only through the transition helpers below.
const DERIVED_OR_CONTROLLED = new Set([
  "pipeline", "stage", "status", "probability", "ownerName", "handoffOwnerName", "weightedValue", "expectedRecurringValue",
  "lineItems", "quotes", "files", "stageHistory", "auditLog", "winReason", "lossReason", "cancellationReason", "onHoldReason",
  "actualClosingDate", "archived", "archiveReason", "archivedAt",
]);

export function toApiDeal(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (DERIVED_OR_CONTROLLED.has(key)) continue;
    if (key === "ownerId") out.ownerMembershipId = value || null;
    else if (key === "handoffOwnerId") out.handoffOwnerMembershipId = value || null;
    else out[key] = value;
  }
  return out;
}

async function context() {
  const [ownersById, pipelines] = await Promise.all([ownersMap(), fetchPipelines()]);
  return { ownersById, pipelines };
}

// --- Reads ---

export async function listDeals() {
  const organizationId = orgId();
  const ctx = await context();
  const fetchAll = (archived) =>
    listAll(async (page, pageSize) => {
      const { deals, total } = await sales.listDeals(organizationId, { page, pageSize, archived });
      return { items: deals || [], total };
    });
  const [active, archived] = await Promise.all([fetchAll("false"), fetchAll("true")]);
  return [...active, ...archived].map((d) => toUiDeal(d, ctx));
}

export async function getDeal(dealId) {
  const organizationId = orgId();
  const [{ deal }, history, ctx] = await Promise.all([
    sales.getDeal(organizationId, dealId),
    sales.getDealStageHistory(organizationId, dealId).then((r) => r.stageHistory || []).catch(() => []),
    context(),
  ]);
  return toUiDeal(deal, { ...ctx, stageHistory: history });
}

// --- Writes ---

export async function createDeal(payload) {
  const pipelines = await fetchPipelines();
  const pipeline = findPipeline(pipelines, payload.pipeline);
  const stage = findStage(pipeline, payload.stage);
  const { deal } = await sales.createDeal(orgId(), {
    ...toApiDeal(payload),
    pipelineId: pipeline?._id,
    ...(stage && stage.classification === "Open" ? { pipelineStageId: stage._id } : {}),
  });
  if (payload.lineItems?.length) await replaceLineItems(deal._id, payload.lineItems);
  return getDeal(deal._id);
}

export async function updateDeal(dealId, changes) {
  const { stage, pipeline, lineItems, ...rest } = changes;
  const apiChanges = toApiDeal(rest);
  if (Object.keys(apiChanges).length) await sales.updateDeal(orgId(), dealId, apiChanges);
  if (lineItems) await replaceLineItems(dealId, lineItems);
  // The edit form sends the current stage/pipeline back unchanged; only an
  // actual change goes through the transition rules.
  if (stage || pipeline) {
    const current = await getDeal(dealId);
    if ((stage && stage !== current.stage) || (pipeline && pipeline !== current.pipeline)) {
      await transitionTo(dealId, { pipelineName: pipeline, stageName: stage || current.stage });
    }
  }
  return getDeal(dealId);
}

async function transitionTo(dealId, { pipelineName, stageName, reason, actualClosingDate }) {
  const pipelines = await fetchPipelines();
  const { deal } = await sales.getDeal(orgId(), dealId);
  const pipeline = findPipeline(pipelines, pipelineName || deal.pipelineId);
  const stage = findStage(pipeline, stageName);
  if (!stage) throw new Error(`Stage "${stageName}" doesn't exist in the ${pipeline?.name || "selected"} pipeline.`);
  await sales.transitionDeal(orgId(), dealId, {
    pipelineId: pipeline._id,
    pipelineStageId: stage._id,
    reason,
    actualClosingDate: stage.classification === "Won" ? actualClosingDate || new Date().toISOString() : undefined,
  });
}

export async function changeStage(dealId, { stage, pipeline, note }) {
  await transitionTo(dealId, { pipelineName: pipeline, stageName: stage, reason: note });
  return getDeal(dealId);
}

export async function markWon(dealId, { actualClosingDate, winReason, handoffOwnerId, value, note }) {
  const changes = {};
  if (value !== undefined) changes.value = value;
  if (handoffOwnerId) changes.handoffOwnerMembershipId = handoffOwnerId;
  if (Object.keys(changes).length) await sales.updateDeal(orgId(), dealId, changes);
  await sales.markDealWon(orgId(), dealId, { winReason, actualClosingDate });
  if (note) await addNoteTo({ dealId }, note);
  return getDeal(dealId);
}

export async function markLost(dealId, { lossReason, lossCompetitor, note }) {
  if (lossCompetitor) await sales.updateDeal(orgId(), dealId, { lossCompetitor });
  await sales.markDealLost(orgId(), dealId, lossReason);
  if (note) await addNoteTo({ dealId }, note);
  return getDeal(dealId);
}

export async function cancelDeal(dealId, { cancellationReason }) {
  await transitionTo(dealId, { stageName: "Cancelled", reason: cancellationReason });
  return getDeal(dealId);
}

export async function putOnHold(dealId, { onHoldReason, onHoldReviewDate, ownerId }) {
  const changes = { onHoldReviewDate };
  if (ownerId) changes.ownerMembershipId = ownerId;
  await sales.updateDeal(orgId(), dealId, changes);
  await transitionTo(dealId, { stageName: "On Hold", reason: onHoldReason });
  return getDeal(dealId);
}

// The Reopen dialog asks for a target stage, a new close date and a next
// action; the backend requires a written reason, so the next action (with
// the stage) is recorded as that reason.
export async function reopen(dealId, { stage, expectedClosingDate, nextAction }) {
  await sales.reopenDeal(orgId(), dealId, `Reopened to ${stage || "an open stage"}: ${nextAction || "no next action given"}`);
  await sales.updateDeal(orgId(), dealId, { expectedClosingDate, nextAction });
  const { deal } = await sales.getDeal(orgId(), dealId);
  if (stage && deal.stage !== stage) await transitionTo(dealId, { stageName: stage });
  return getDeal(dealId);
}

export async function archiveDeal(dealId, reason) {
  await sales.archiveDeal(orgId(), dealId, reason);
  return getDeal(dealId);
}

export async function restoreDeal(dealId) {
  await sales.restoreDeal(orgId(), dealId);
  return getDeal(dealId);
}

// --- Deal contacts (additionalContactIds + contactRoles on the deal) ---

async function editContacts(dealId, edit) {
  const { deal } = await sales.getDeal(orgId(), dealId);
  const current = {
    primaryContactId: deal.primaryContactId || null,
    additionalContactIds: Array.isArray(deal.additionalContactIds) ? deal.additionalContactIds : [],
    contactRoles: Array.isArray(deal.contactRoles) ? deal.contactRoles : [],
  };
  await sales.updateDeal(orgId(), dealId, edit(current));
  return getDeal(dealId);
}

export function addContact(dealId, { contactId, role, influenceLevel, relationship }) {
  return editContacts(dealId, ({ primaryContactId, additionalContactIds, contactRoles }) => ({
    additionalContactIds: additionalContactIds.includes(contactId) || primaryContactId === contactId ? additionalContactIds : [...additionalContactIds, contactId],
    contactRoles: [...contactRoles.filter((r) => r.contactId !== contactId), { contactId, role: role || null, influenceLevel: influenceLevel || null, relationship: relationship || null }],
  }));
}

export function updateContactRole(dealId, contactId, changes) {
  return editContacts(dealId, ({ contactRoles }) => ({
    contactRoles: contactRoles.some((r) => r.contactId === contactId)
      ? contactRoles.map((r) => (r.contactId === contactId ? { ...r, ...changes } : r))
      : [...contactRoles, { contactId, role: null, influenceLevel: null, relationship: null, ...changes }],
  }));
}

export function setPrimaryContact(dealId, contactId) {
  return editContacts(dealId, ({ primaryContactId, additionalContactIds }) => ({
    primaryContactId: contactId,
    additionalContactIds: [...additionalContactIds.filter((id) => id !== contactId), ...(primaryContactId && primaryContactId !== contactId ? [primaryContactId] : [])],
  }));
}

export function removeContact(dealId, contactId) {
  return editContacts(dealId, ({ primaryContactId, additionalContactIds, contactRoles }) => ({
    ...(primaryContactId === contactId ? { primaryContactId: null } : {}),
    additionalContactIds: additionalContactIds.filter((id) => id !== contactId),
    contactRoles: contactRoles.filter((r) => r.contactId !== contactId),
  }));
}

// --- Line items: the UI saves the whole list at once ---

async function replaceLineItems(dealId, lineItems) {
  const organizationId = orgId();
  const { lineItems: existing } = await sales.listDealLineItems(organizationId, dealId);
  for (const item of existing || []) await sales.deleteDealLineItem(organizationId, dealId, item._id);
  for (const item of lineItems) {
    await sales.createDealLineItem(organizationId, dealId, {
      catalogItemId: item.productId || undefined,
      name: item.name,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      discountType: Number(item.discountPercent) ? "Percentage" : undefined,
      discountValue: Number(item.discountPercent) || undefined,
      billingFrequency: item.billingFrequency || "One-time",
    });
  }
}

export async function setLineItems(dealId, lineItems) {
  await replaceLineItems(dealId, lineItems);
  return getDeal(dealId);
}

export function addQuotePreview() {
  return Promise.reject(notSupported("Adding a quote from the deal page (use Sales → Quotes)"));
}

// --- Bulk ---

async function bulkRefetch(ids) {
  return Promise.all(ids.map((id) => getDeal(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export async function bulkAssign(ids, ownerId) {
  await sales.bulkDeals(orgId(), { action: "assign", ids, ownerMembershipId: ownerId });
  return bulkRefetch(ids);
}

export async function bulkArchive(ids, reason) {
  await sales.bulkDeals(orgId(), { action: "archive", ids, reason });
  return bulkRefetch(ids);
}

// No bulk transition endpoint: each deal moves through the same transition
// rules one at a time; deals the rules reject are skipped.
export async function bulkStage(ids, stage) {
  const moved = [];
  for (const id of ids) {
    try {
      await transitionTo(id, { stageName: stage });
      moved.push(id);
    } catch {
      // left in place — the rule that rejected it applies per deal
    }
  }
  return bulkRefetch(moved);
}
