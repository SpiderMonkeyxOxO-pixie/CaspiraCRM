// Backend Phase 8 — explicit provider actions: post an approved notification
// (Slack, Teams), create an email draft (Gmail, Outlook) and link one email
// message to a CRM record (headers only).
//
// Every action is two steps. Preview validates everything and shows exactly
// what will be sent; nothing leaves yet. Execute needs `confirm: true`, runs
// once per preview, and only for the person who prepared it. Drafts are never
// sent. Recipients marked Do-Not-Contact are refused. Export actions need the
// organization's policy to allow Export Only. Personal connections act only
// for the person who connected them. Nothing here runs automatically.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { IntegrationError, KINDS } from "../common/errors.js";
import { integrationAudit } from "../common/audit.js";
import { getAdapter } from "../providers/registry.js";
import { accessTokenFor, assertCallable, recordOutcome } from "../connections/connectionService.js";
import { getPolicy, assertProviderAllowed, assertDirectionAllowed } from "../policies/policyService.js";

export const ACTIONS = {
  "slack.notify": { kind: "notify" },
  "teams.notify": { kind: "notify" },
  "gmail.draft": { kind: "draft" },
  "outlook.draft": { kind: "draft" },
  "gmail.link_message": { kind: "link" },
  "outlook.link_message": { kind: "link" },
};
export const ACTION_PREVIEW_TTL_MS = 15 * 60_000;
const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;
const LINK_TARGETS = { contactId: "contact", companyId: "company", dealId: "deal", leadId: "lead" };
const invalid = (m) => new IntegrationError(KINDS.PERMANENT, m);

// Broadcast mentions would notify a whole channel; they're removed.
export function neutralizeMentions(text) {
  let removed = 0;
  const out = String(text)
    .replace(/<!(channel|here|everyone)[^>]*>/gi, () => { removed += 1; return "[mention removed]"; })
    .replace(/(^|\s)@(channel|here|everyone)\b/gi, (_m, pre) => { removed += 1; return `${pre}[mention removed]`; });
  return { text: out, removed };
}

// Emails of CRM contacts and leads marked Do-Not-Contact, among `emails`.
export async function doNotContactMatches(organizationId, emails, db = prisma) {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  const [contacts, leads] = await Promise.all([
    db.contact.findMany({ where: { organizationId, doNotContact: true, normalizedEmail: { in: normalized } }, select: { normalizedEmail: true } }),
    db.lead.findMany({ where: { organizationId, doNotContact: true, normalizedEmail: { in: normalized } }, select: { normalizedEmail: true } }),
  ]);
  return [...new Set([...contacts, ...leads].map((r) => r.normalizedEmail))];
}

function assertActor(req, connection) {
  if (connection.ownershipType === "User Connection" && connection.connectedMembershipId !== req.membership?.id) {
    throw new IntegrationError(KINDS.POLICY, "Only the person who connected this account can act through it.");
  }
}

async function capabilityFor(connection, capability) {
  const action = ACTIONS[capability];
  if (!action) throw invalid(`Unknown action. Available: ${Object.keys(ACTIONS).join(", ")}.`);
  const provider = await prisma.integrationProvider.findUnique({ where: { key: connection.providerKey } });
  const cap = (provider?.capabilities || []).find((c) => c.key === capability);
  if (!cap) throw invalid(`${provider?.name || connection.providerKey} doesn't offer ${capability}.`);
  if (cap.requiresPhase) throw new IntegrationError(KINDS.UNSUPPORTED, cap.unavailableReason);
  const missing = (cap.requiredScopes || []).filter((s) => !(connection.grantedScopes || []).includes(s));
  if (missing.length) throw new IntegrationError(KINDS.SCOPE_MISSING, `Missing scopes for this action: ${missing.join(", ")}. Reauthorize to add them.`);
  return { action, provider, cap };
}

async function linkTarget(req, input) {
  const keys = Object.keys(LINK_TARGETS).filter((k) => input[k]);
  if (keys.length !== 1) throw invalid("Choose exactly one CRM record to link to (contactId, companyId, dealId or leadId).");
  const key = keys[0];
  const record = await prisma[LINK_TARGETS[key]].findFirst({ where: { id: String(input[key]), organizationId: req.organizationId }, select: { id: true } });
  if (!record) throw invalid("That CRM record wasn't found.");
  return { [key]: record.id };
}

// ---- Preview ------------------------------------------------------------------

export async function previewAction(req, connection, { capability, input = {} }) {
  assertActor(req, connection);
  const { action, provider, cap } = await capabilityFor(connection, capability);
  const policy = await getPolicy(connection.organizationId);
  assertProviderAllowed(policy, provider);
  if (action.kind !== "link") assertDirectionAllowed(policy, "Export Only");
  assertCallable(connection);

  const warnings = [];
  const notes = [];
  let payload;
  if (action.kind === "notify") {
    const channel = String(input.channel || "").trim();
    if (!/^[\w:@.-]{1,200}$/.test(channel)) throw invalid("Choose the channel to post to.");
    if (capability === "teams.notify" && !String(input.teamId || "").trim()) throw invalid("Choose the team.");
    const raw = String(input.text || "").trim();
    if (!raw || raw.length > 3000) throw invalid("The message must be 1–3000 characters.");
    const { text, removed } = neutralizeMentions(raw);
    if (removed) warnings.push(`${removed} broadcast mention(s) (@channel, @here, @everyone) were removed.`);
    payload = { channel, ...(input.teamId && { teamId: String(input.teamId).trim() }), text };
    notes.push("Posted once, to this channel only, after you confirm.");
  } else if (action.kind === "draft") {
    const to = [...new Set([].concat(input.to || []).map((e) => String(e).trim()).filter(Boolean))];
    if (!to.length || to.length > 20) throw invalid("Add 1–20 recipients.");
    const bad = to.filter((e) => !EMAIL.test(e));
    if (bad.length) throw invalid(`Not valid email addresses: ${bad.join(", ")}.`);
    const blocked = await doNotContactMatches(req.organizationId, to);
    if (blocked.length) throw new IntegrationError(KINDS.POLICY, `These recipients are marked Do-Not-Contact: ${blocked.join(", ")}.`);
    const subject = String(input.subject || "").replace(/[\r\n]+/g, " ").trim();
    if (!subject || subject.length > 200) throw invalid("The subject must be 1–200 characters.");
    const body = String(input.body || "");
    if (body.length > 20_000) throw invalid("The body is too long (20,000 characters at most).");
    payload = { to, subject, body };
    notes.push("Created as a draft in your mailbox. It is never sent automatically — you send it yourself.");
  } else {
    if (!hasGrant(req, "activities", "create")) throw new IntegrationError(KINDS.POLICY, "Linking an email creates an activity; your role can't create activities.");
    const messageId = String(input.messageId || "").trim();
    if (!messageId || messageId.length > 300) throw invalid("Choose the email message to link.");
    const target = await linkTarget(req, input);
    const existing = await prisma.integrationRecordMapping.findUnique({ where: { connectionId_providerEntityType_externalId: { connectionId: connection.id, providerEntityType: "email_thread", externalId: messageId } } });
    if (existing?.syncState === "Active") throw new IntegrationError(KINDS.PERMANENT, "This email is already linked.");
    const adapter = getAdapter(connection.providerKey, connection.mode);
    if (!adapter.supports("readMessage")) throw new IntegrationError(KINDS.UNSUPPORTED, "This provider can't read message headers.");
    let meta;
    try {
      meta = await adapter.readMessage({ accessToken: await accessTokenFor(connection), messageId });
      await recordOutcome(connection);
    } catch (err) {
      if (err instanceof IntegrationError) await recordOutcome(connection, err);
      throw err;
    }
    if (meta.category === "security") throw new IntegrationError(KINDS.POLICY, "Authentication and security messages can't be linked.");
    payload = { messageId, threadId: meta.threadId || null, subject: meta.subject, from: meta.from, to: meta.to || [], date: meta.date, target };
    notes.push("Only the subject, sender, recipients and date are stored — never the message body.");
  }

  const run = await prisma.integrationSyncRun.create({
    data: {
      organizationId: connection.organizationId, connectionId: connection.id, capability, kind: "Action Preview", trigger: "Manual", direction: cap.direction,
      status: "Awaiting Confirmation", startedAt: new Date(), completedAt: new Date(), apiCalls: action.kind === "link" ? 1 : 0,
      preview: { kind: action.kind, capability, payload, warnings, notes }, previewExpiresAt: new Date(Date.now() + ACTION_PREVIEW_TTL_MS),
      initiatedByMembershipId: req.membership?.id || null, correlationId: crypto.randomUUID(),
    },
  });
  await integrationAudit(req, "integrations.action.previewed", "IntegrationSyncRun", run.id, { after: { capability, connectionId: connection.id } });
  return run;
}

// ---- Execute ------------------------------------------------------------------

export async function executeAction(req, connection, { previewRunId, confirm }) {
  if (confirm !== true) throw invalid("Confirm the action (confirm: true) after reviewing the preview.");
  assertActor(req, connection);
  const run = await prisma.integrationSyncRun.findFirst({ where: { id: String(previewRunId || ""), connectionId: connection.id, kind: "Action Preview" } });
  if (!run) throw new IntegrationError(KINDS.PERMANENT, "That action preview wasn't found.");
  if (run.initiatedByMembershipId !== (req.membership?.id || null)) throw new IntegrationError(KINDS.POLICY, "Only the person who prepared this action can confirm it.");
  if (run.status === "Awaiting Confirmation" && run.previewExpiresAt < new Date()) {
    await prisma.integrationSyncRun.update({ where: { id: run.id }, data: { status: "Expired" } });
    throw new IntegrationError(KINDS.PERMANENT, "The preview expired. Prepare the action again.");
  }
  const claimed = await prisma.integrationSyncRun.updateMany({
    where: { id: run.id, status: "Awaiting Confirmation" },
    data: { status: "Running", confirmedAt: new Date(), confirmedByMembershipId: req.membership?.id || null },
  });
  if (claimed.count !== 1) throw new IntegrationError(KINDS.PERMANENT, `This action was already ${run.status === "Completed" ? "carried out" : run.status.toLowerCase()}; each preview runs once.`);

  const { kind, payload } = run.preview;
  let result;
  try {
    assertCallable(connection);
    if (kind === "link") {
      result = await prisma.$transaction(async (tx) => {
        const activity = await tx.activity.create({
          data: {
            organizationId: connection.organizationId, title: `Email: ${payload.subject || "(no subject)"}`.slice(0, 200), type: "Email", status: "Completed",
            completedAt: payload.date && !Number.isNaN(Date.parse(payload.date)) ? new Date(payload.date) : new Date(),
            description: `From ${payload.from || "unknown"} to ${(payload.to || []).join(", ") || "unknown"}. Linked from ${connection.providerKey} — headers only; the message body is not stored.`.slice(0, 2000),
            ...payload.target, source: `Integration: ${connection.providerKey}`, ownerMembershipId: req.membership?.id || null, createdByMembershipId: req.membership?.id || null,
          },
        });
        const key = { connectionId: connection.id, providerEntityType: "email_thread", externalId: payload.messageId };
        await tx.integrationRecordMapping.upsert({
          where: { connectionId_providerEntityType_externalId: key },
          create: { organizationId: connection.organizationId, ...key, crmEntityType: "activity", crmRecordId: activity.id, lastSyncedAt: new Date(), lastWriteOrigin: "Provider" },
          update: { crmRecordId: activity.id, syncState: "Active", lastSyncedAt: new Date(), lastWriteOrigin: "Provider" },
        });
        return { activityId: activity.id };
      });
    } else {
      const adapter = getAdapter(connection.providerKey, connection.mode);
      if (!adapter.supports("performAction")) throw new IntegrationError(KINDS.UNSUPPORTED, "This provider can't carry out that action.");
      const out = await adapter.performAction({ accessToken: await accessTokenFor(connection), kind, payload, idempotencyKey: run.id });
      result = { externalId: out.externalId };
      await recordOutcome(connection);
    }
  } catch (err) {
    await prisma.integrationSyncRun.update({ where: { id: run.id }, data: { status: "Failed", completedAt: new Date(), failures: 1, errorCode: err.kind || "unexpected", errorMessage: (err instanceof IntegrationError ? err.message : "The action failed.").slice(0, 500) } });
    if (err instanceof IntegrationError && kind !== "link") await recordOutcome(connection, err);
    await integrationAudit(req, "integrations.action.failed", "IntegrationSyncRun", run.id, { result: "Failure", after: { capability: run.capability, error: err.kind || "unexpected" } });
    throw err;
  }
  const done = await prisma.integrationSyncRun.update({
    where: { id: run.id },
    data: { status: "Completed", completedAt: new Date(), created: 1, apiCalls: { increment: kind === "link" ? 0 : 1 }, preview: { ...run.preview, result } },
  });
  await integrationAudit(req, "integrations.action.executed", "IntegrationSyncRun", run.id, { after: { capability: run.capability, connectionId: connection.id, ...result } });
  return done;
}
