// Backend Phase 10 — semantic retrieval, tenant- and permission-filtered IN
// THE QUERY: organization, embedding model/version, record types the user's
// modules allow and, for "own" scopes, the user's own records. Nothing is
// searched globally and filtered afterwards. Scores are cosine similarity
// over normalized vectors. Every hit is then re-verified through its domain
// handler before it can reach the model; similarity is never used for
// totals, ownership, permissions or record states.
import prisma from "../../../lib/prisma.js";
import { hasGrant } from "../../../utils/grants.js";
import { broadestScope } from "../../../services/crm/scopeService.js";
import { callHandler } from "../../actions/actionTypes.js";
import { embedTexts, embeddingConfig, semanticEnabled } from "./embeddings.js";
import { MODULE_OF } from "./indexer.js";
import * as activities from "../../../controllers/crm/activitiesController.js";
import * as tickets from "../../../controllers/support/ticketsController.js";
import * as projects from "../../../controllers/projects/projectsController.js";
import * as contracts from "../../../controllers/sales/contractsController.js";
import * as kb from "../../../controllers/support/knowledgeBaseController.js";
import { RECORD_ROUTES, labelOf } from "../evidence.js";

const VERIFY = {
  Activity: (req, id) => callHandler(activities.getOne, req, { params: { activityId: id } }).then((o) => (o.status === 200 ? o.body.activity : null)),
  Ticket: (req, id) => callHandler(tickets.getOne, req, { params: { ticketId: id } }).then((o) => (o.status === 200 ? o.body.ticket : null)),
  Project: (req, id) => callHandler(projects.getOne, req, { params: { projectId: id } }).then((o) => (o.status === 200 ? o.body.project : null)),
  Contract: (req, id) => callHandler(contracts.getOne, req, { params: { contractId: id } }).then((o) => (o.status === 200 ? o.body.contract : null)),
  KnowledgeArticle: (req, id) => callHandler(kb.getArticle, req, { params: { articleId: id } }).then((o) => (o.status === 200 ? o.body.article : null)),
};

// The note is visible if the parent record it hangs off is visible.
async function verifyNote(req, noteId) {
  const n = await prisma.crmNote.findFirst({ where: { id: noteId, organizationId: req.organizationId, archivedAt: null } });
  if (!n) return null;
  if (n.activityId) return (await VERIFY.Activity(req, n.activityId)) ? n : null;
  const parent = n.dealId ? ["deals", "Deal"] : n.companyId ? ["companies", "Company"] : n.contactId ? ["contacts", "Contact"] : n.leadId ? ["leads", "Lead"] : null;
  return parent && hasGrant(req, parent[0], "view") ? n : null;
}

// SQL filters for the caller: permitted types and, where scope is Own, own records.
function permissionFilter(req, types) {
  const allowed = [];
  const ownOnly = [];
  for (const t of types) {
    const mod = MODULE_OF[t];
    if (!hasGrant(req, mod, "view")) continue;
    allowed.push(t);
    const scope = req.isSystemOwnerOverride ? "Organization" : broadestScope(req.membership, mod);
    if (["Own", "Assigned"].includes(scope)) ownOnly.push(t);
  }
  return { allowed, ownOnly };
}

export async function semanticSearch(req, query, { types = Object.keys(MODULE_OF), limit = 8, candidates = 30 } = {}) {
  if (!semanticEnabled()) return { hits: [], disabled: true };
  const cfg = embeddingConfig();
  const { allowed, ownOnly } = permissionFilter(req, types);
  if (!allowed.length) return { hits: [], disabled: false, noAccess: true };
  const [vector] = await embedTexts(req.organizationId, [query], { useCaseKey: "copilot.embedding" });
  const me = req.membership?.id || "none";
  const rows = await prisma.$queryRaw`
    SELECT c.id AS "chunkId", c."recordType", c."recordId", c."sectionLabel", c.text, c."sourceVersion", c."updatedAt",
           (SELECT SUM(a * b) FROM unnest(e.vector, ${vector}::double precision[]) AS t(a, b)) AS score
    FROM ai_source_embeddings e
    JOIN ai_source_chunks c ON c.id = e."chunkId"
    WHERE e."organizationId" = ${req.organizationId}
      AND c."organizationId" = ${req.organizationId}
      AND e."embeddingModel" = ${cfg.model} AND e."embeddingVersion" = ${cfg.version}
      AND c.status = 'Indexed' AND c."deletedAt" IS NULL
      AND c."recordType" = ANY(${allowed}::text[])
      AND (NOT (c."recordType" = ANY(${ownOnly}::text[]))
           OR c."permissionMeta"->>'ownerMembershipId' = ${me}
           OR c."permissionMeta"->>'assignedMembershipId' = ${me}
           OR c."permissionMeta"->>'renewalOwnerMembershipId' = ${me})
    ORDER BY score DESC
    LIMIT ${candidates}`;
  // Best chunk per record, then verify each record through its handler.
  const best = new Map();
  for (const r of rows) {
    const key = `${r.recordType}:${r.recordId}`;
    if (!best.has(key) || best.get(key).score < r.score) best.set(key, r);
  }
  const hits = [];
  for (const r of [...best.values()].sort((a, b) => b.score - a.score)) {
    if (hits.length >= limit || Number(r.score) < 0.05) break;
    const record = r.recordType === "CrmNote" ? await verifyNote(req, r.recordId) : await VERIFY[r.recordType]?.(req, r.recordId);
    if (!record) continue; // not visible to this user → never reaches the model
    hits.push({
      recordType: r.recordType, recordId: r.recordId, chunkId: r.chunkId, score: Math.round(Number(r.score) * 1000) / 1000,
      label: r.recordType === "CrmNote" ? "Note" : labelOf(record, r.recordType), section: r.sectionLabel, text: r.text,
      route: RECORD_ROUTES[r.recordType === "CrmNote" ? "Activity" : r.recordType]?.(r.recordId) || null,
      updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null, sourceVersion: r.sourceVersion,
      fields: {}, masked: [],
    });
  }
  return { hits, disabled: false };
}
