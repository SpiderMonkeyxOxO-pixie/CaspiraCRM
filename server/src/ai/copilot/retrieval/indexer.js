// Backend Phase 10 — indexing for semantic retrieval.
//
// Sources (implemented modules only): published Knowledge Base articles,
// Activities, CRM notes, Tickets (public messages only), Projects and
// Contracts (customer-facing text only). Documents wait for Phase 7.
//
// A record is (re)indexed when the audit trail reports a change to it
// (including ownership/permission changes) and by a catch-up sweep. Text is
// extracted from approved fields only, secrets and contact details are
// masked, chunking is deterministic, and every chunk carries its
// organization, source version, sensitivity and permission metadata.
// Archived, deleted or unpublished sources lose their chunks and vectors.
import crypto from "node:crypto";
import prisma from "../../../lib/prisma.js";
import { scrub } from "../../common/audit.js";
import { embedTexts, embeddingConfig } from "./embeddings.js";

const CHUNK_SIZE = 800;
const OVERLAP = 100;
const MAX_CHUNKS = 20;
export const INDEXED_TYPES = ["KnowledgeArticle", "Activity", "CrmNote", "Ticket", "Project", "Contract"];
const TARGET_ALIASES = { KbArticle: "KnowledgeArticle", KnowledgeArticle: "KnowledgeArticle", Activity: "Activity", CrmNote: "CrmNote", Ticket: "Ticket", Project: "Project", Contract: "Contract" };
export const MODULE_OF = { KnowledgeArticle: "knowledge_base", Activity: "activities", CrmNote: "activities", Ticket: "tickets", Project: "projects", Contract: "contracts" };

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const clean = (s) => scrub(String(s || ""))
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => `${m[0]}***@${m.split("@")[1]}`)
  .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export function chunkText(sections) {
  const out = [];
  for (const { label, text } of sections) {
    const t = clean(text);
    if (!t) continue;
    for (let start = 0; start < t.length && out.length < MAX_CHUNKS; start += CHUNK_SIZE - OVERLAP) {
      out.push({ sectionLabel: label, text: t.slice(start, start + CHUNK_SIZE) });
      if (start + CHUNK_SIZE >= t.length) break;
    }
  }
  return out;
}

// → { sections, version, permissionMeta, sensitivity } or null (not indexable: remove chunks)
export async function extractSource(organizationId, recordType, recordId) {
  if (recordType === "KnowledgeArticle") {
    const a = await prisma.kbArticle.findFirst({ where: { id: recordId, organizationId } });
    if (!a || a.archivedAt || a.status !== "Published") return null;
    const v = a.currentVersionId ? await prisma.kbArticleVersion.findUnique({ where: { id: a.currentVersionId } }) : null;
    return { sections: [{ label: "title", text: a.title }, { label: "summary", text: v?.summary || a.summary }, { label: "body", text: v?.body }], version: `${a.updatedAt.toISOString()}:${a.currentVersionId || ""}`, permissionMeta: { visibility: a.visibility }, sensitivity: a.visibility === "Internal" ? "Internal" : "Public" };
  }
  if (recordType === "Activity") {
    const a = await prisma.activity.findFirst({ where: { id: recordId, organizationId } });
    if (!a || a.archivedAt) return null;
    return { sections: [{ label: "title", text: a.title }, { label: "description", text: a.description }, { label: "outcome", text: a.outcome }, { label: "agenda", text: a.agenda }], version: a.updatedAt.toISOString(), permissionMeta: { ownerMembershipId: a.ownerMembershipId, assignedMembershipId: a.assignedMembershipId, companyId: a.companyId, contactId: a.contactId, dealId: a.dealId, leadId: a.leadId }, sensitivity: "Internal" };
  }
  if (recordType === "CrmNote") {
    const n = await prisma.crmNote.findFirst({ where: { id: recordId, organizationId } });
    if (!n || n.archivedAt) return null;
    return { sections: [{ label: "note", text: n.body }], version: n.updatedAt.toISOString(), permissionMeta: { ownerMembershipId: n.authorMembershipId, leadId: n.leadId, contactId: n.contactId, companyId: n.companyId, activityId: n.activityId, dealId: n.dealId }, sensitivity: "Confidential" };
  }
  if (recordType === "Ticket") {
    const t = await prisma.ticket.findFirst({ where: { id: recordId, organizationId } });
    if (!t || t.archivedAt) return null;
    // Public conversation only — internal and restricted notes are never indexed.
    const msgs = await prisma.ticketMessage.findMany({ where: { ticketId: t.id, organizationId, visibility: "Customer Visible", archivedAt: null }, orderBy: { createdAt: "asc" }, take: 30, select: { sanitizedBody: true, body: true } }).catch(() => []);
    return { sections: [{ label: "subject", text: t.subject }, { label: "description", text: t.description }, { label: "resolution", text: t.resolutionSummary }, { label: "conversation", text: msgs.map((m) => m.sanitizedBody || m.body).join("\n") }], version: t.updatedAt.toISOString(), permissionMeta: { ownerMembershipId: t.ownerMembershipId, assignedMembershipId: t.assignedMembershipId, companyId: t.companyId }, sensitivity: "Confidential" };
  }
  if (recordType === "Project") {
    const p = await prisma.project.findFirst({ where: { id: recordId, organizationId } });
    if (!p || p.archivedAt) return null;
    return { sections: [{ label: "name", text: p.name }, { label: "description", text: p.description }, { label: "customer summary", text: p.customerSummary }, { label: "health note", text: p.healthNote }], version: p.updatedAt.toISOString(), permissionMeta: { ownerMembershipId: p.ownerMembershipId, companyId: p.companyId }, sensitivity: "Internal" };
  }
  if (recordType === "Contract") {
    const c = await prisma.contract.findFirst({ where: { id: recordId, organizationId } });
    if (!c || c.archivedAt) return null;
    // Customer-facing terms only; internal notes are not indexed.
    return { sections: [{ label: "contract", text: `${c.contractNumber || ""} ${c.contractType || ""}` }, { label: "payment terms", text: c.paymentTerms }, { label: "customer note", text: c.customerNote }], version: c.updatedAt.toISOString(), permissionMeta: { ownerMembershipId: c.ownerMembershipId, renewalOwnerMembershipId: c.renewalOwnerMembershipId, companyId: c.companyId }, sensitivity: "Confidential" };
  }
  return null;
}

export async function enqueueIndexJob({ organizationId, recordType, recordId, kind = "Reindex", reason }) {
  if (!organizationId || !INDEXED_TYPES.includes(recordType)) return null;
  const queued = await prisma.aiIndexingJob.findFirst({ where: { organizationId, recordType, recordId, status: "Queued" } });
  if (queued) return queued;
  return prisma.aiIndexingJob.create({ data: { organizationId, kind, recordType, recordId, reason: String(reason || "change").slice(0, 200) } });
}

// Audit listener: any change to an indexable record queues a reindex.
export async function indexFromAudit(event) {
  const type = TARGET_ALIASES[event?.targetType];
  if (!type || !event.targetId || !event.organizationId || event.result !== "Success") return;
  await enqueueIndexJob({ organizationId: event.organizationId, recordType: type, recordId: String(event.targetId), reason: event.action });
}

export async function removeSource(organizationId, recordType, recordId) {
  const chunks = await prisma.aiSourceChunk.findMany({ where: { organizationId, recordType, recordId }, select: { id: true } });
  if (!chunks.length) return 0;
  await prisma.aiSourceEmbedding.deleteMany({ where: { chunkId: { in: chunks.map((c) => c.id) } } });
  await prisma.aiSourceChunk.deleteMany({ where: { organizationId, recordType, recordId } });
  return chunks.length;
}

export async function indexSource(organizationId, recordType, recordId) {
  const source = await extractSource(organizationId, recordType, recordId);
  if (!source) return { removed: await removeSource(organizationId, recordType, recordId), chunks: 0 };
  const cfg = embeddingConfig();
  const chunks = chunkText(source.sections);
  const existing = await prisma.aiSourceChunk.findMany({ where: { organizationId, recordType, recordId } });
  const unchanged = existing.length === chunks.length && existing.every((e) => e.sourceVersion === source.version && e.status === "Indexed" && JSON.stringify(e.permissionMeta) === JSON.stringify(source.permissionMeta));
  if (unchanged && cfg.provider !== "disabled") {
    const hasVectors = await prisma.aiSourceEmbedding.count({ where: { chunkId: { in: existing.map((e) => e.id) }, embeddingModel: cfg.model, embeddingVersion: cfg.version } });
    if (hasVectors === existing.length) return { chunks: existing.length, unchanged: true };
  }
  await removeSource(organizationId, recordType, recordId);
  if (!chunks.length) return { chunks: 0 };
  const vectors = cfg.provider === "disabled" ? [] : await embedTexts(organizationId, chunks.map((c) => `${c.sectionLabel}: ${c.text}`));
  await prisma.$transaction(async (tx) => {
    const rows = await tx.aiSourceChunk.createManyAndReturn({
      data: chunks.map((c, i) => ({
        organizationId, sourceModule: MODULE_OF[recordType], recordType, recordId, sourceVersion: source.version, chunkIndex: i,
        sectionLabel: c.sectionLabel, text: c.text, textHash: sha(c.text), sensitivity: source.sensitivity, permissionMeta: source.permissionMeta, status: "Indexed",
      })),
      select: { id: true, chunkIndex: true },
    });
    const withVectors = rows.filter((r) => vectors[r.chunkIndex]);
    if (withVectors.length) await tx.aiSourceEmbedding.createMany({ data: withVectors.map((r) => ({ organizationId, chunkId: r.id, embeddingModel: cfg.model, embeddingVersion: cfg.version, dimensions: vectors[r.chunkIndex].length, vector: vectors[r.chunkIndex] })) });
  }, { timeout: 30_000 });
  return { chunks: chunks.length, tokens: chunks.reduce((s, c) => s + Math.ceil(c.text.length / 4), 0) };
}

// Worker: process queued jobs (bounded).
export async function runIndexingJobs({ max = 25 } = {}) {
  let done = 0;
  for (; done < max; done += 1) {
    const job = await prisma.aiIndexingJob.findFirst({ where: { status: "Queued" }, orderBy: { createdAt: "asc" } });
    if (!job) break;
    const claimed = await prisma.aiIndexingJob.updateMany({ where: { id: job.id, status: "Queued" }, data: { status: "Running", startedAt: new Date(), attempts: { increment: 1 } } });
    if (claimed.count !== 1) continue;
    const cfg = embeddingConfig();
    try {
      let result;
      if (job.kind === "Delete") result = { chunks: 0, removed: await removeSource(job.organizationId, job.recordType, job.recordId) };
      else if (job.kind === "Rebuild") result = await rebuildOrganization(job.organizationId);
      else result = await indexSource(job.organizationId, job.recordType, job.recordId);
      await prisma.aiIndexingJob.update({ where: { id: job.id }, data: { status: result.skipped ? "Skipped" : "Succeeded", chunks: result.chunks || 0, usageTokens: result.tokens || 0, embeddingModel: cfg.model, embeddingVersion: cfg.version, completedAt: new Date() } });
    } catch (err) {
      const retry = job.attempts + 1 < 3;
      await prisma.aiIndexingJob.update({ where: { id: job.id }, data: { status: retry ? "Queued" : "Failed", error: String(err.message || "failed").slice(0, 300), completedAt: retry ? null : new Date() } });
    }
  }
  return done;
}

// Queues every indexable record of an organization (e.g. a new embedding model).
export async function rebuildOrganization(organizationId) {
  const ids = async (model, where = {}) => (await prisma[model].findMany({ where: { organizationId, ...where }, select: { id: true }, take: 5000 })).map((r) => r.id);
  const sets = [
    ["KnowledgeArticle", await ids("kbArticle", { status: "Published", archivedAt: null })], ["Activity", await ids("activity", { archivedAt: null })],
    ["CrmNote", await ids("crmNote", { archivedAt: null })], ["Ticket", await ids("ticket", { archivedAt: null })],
    ["Project", await ids("project", { archivedAt: null })], ["Contract", await ids("contract", { archivedAt: null })],
  ];
  let queued = 0;
  for (const [recordType, list] of sets) for (const recordId of list) { await enqueueIndexJob({ organizationId, recordType, recordId, reason: "rebuild" }); queued += 1; }
  return { chunks: 0, queued };
}

// Catch-up: records changed since their chunks were written, and chunks of
// records that no longer exist.
export async function sweepIndex({ since = new Date(Date.now() - 2 * 3_600_000) } = {}) {
  let queued = 0;
  const changed = async (model, recordType) => {
    const rows = await prisma[model].findMany({ where: { updatedAt: { gte: since } }, select: { id: true, organizationId: true }, take: 500 });
    for (const r of rows) if (r.organizationId) { await enqueueIndexJob({ organizationId: r.organizationId, recordType, recordId: r.id, reason: "sweep" }); queued += 1; }
  };
  await changed("kbArticle", "KnowledgeArticle"); await changed("activity", "Activity"); await changed("crmNote", "CrmNote");
  await changed("ticket", "Ticket"); await changed("project", "Project"); await changed("contract", "Contract");
  return queued;
}
