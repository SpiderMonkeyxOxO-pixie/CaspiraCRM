// Backend Phase 10 — Copilot maintenance for the existing worker. Idempotent;
// never calls a generation model (indexing may call the embedding model).
import prisma from "../../lib/prisma.js";
import { getAiPolicy } from "../policy/policyService.js";
import { runIndexingJobs, sweepIndex } from "./retrieval/indexer.js";
import { expireWorkflowRuns } from "./workflows.js";
import { expireMemories } from "./memory.js";

const RUNNING = ["Queued", "Classifying", "Retrieving", "Generating", "Validating"];

// Answers left running by a restarted process.
export async function failStaleCopilotMessages(now = new Date()) {
  const cutoff = new Date(now - 10 * 60_000);
  const m = (await prisma.aiCopilotMessage.updateMany({ where: { status: { in: RUNNING }, createdAt: { lt: cutoff } }, data: { status: "Failed", errorCategory: "unknown", safeError: "The answer didn't finish (the server restarted).", completedAt: now } })).count;
  const r = (await prisma.aiWorkflowRun.updateMany({ where: { status: "Running", updatedAt: { lt: cutoff } }, data: { status: "Failed", errorCategory: "unknown", safeError: "The workflow didn't finish (the server restarted).", completedAt: now } })).count;
  return { messages: m, runs: r };
}

// Conversation content, cached tool results and retrieval logs past the
// organization's retention. Audit metadata is kept.
export async function applyCopilotRetention(now = new Date()) {
  const out = { conversations: 0, toolResults: 0, retrievalLogs: 0 };
  const orgs = await prisma.aiCopilotConversation.findMany({ distinct: ["organizationId"], select: { organizationId: true } });
  for (const { organizationId } of orgs) {
    const { retention } = await getAiPolicy(organizationId);
    const before = (days) => new Date(now.getTime() - days * 86_400_000);
    const old = await prisma.aiCopilotConversation.findMany({ where: { organizationId, status: { not: "Deleted" }, OR: [{ lastMessageAt: { lt: before(retention.copilotConversationDays) } }, { lastMessageAt: null, createdAt: { lt: before(retention.copilotConversationDays) } }] }, select: { id: true }, take: 200 });
    for (const { id } of old) {
      const ids = (await prisma.aiCopilotMessage.findMany({ where: { conversationId: id }, select: { id: true } })).map((m) => m.id);
      await prisma.$transaction([
        prisma.aiCopilotMessagePart.deleteMany({ where: { messageId: { in: ids } } }),
        prisma.aiCopilotCitation.deleteMany({ where: { messageId: { in: ids } } }),
        prisma.aiCopilotMessage.updateMany({ where: { conversationId: id }, data: { content: "[expired]", freshness: null } }),
        prisma.aiCopilotContextLink.deleteMany({ where: { conversationId: id } }),
        prisma.aiCopilotConversation.update({ where: { id }, data: { status: "Deleted", deletedAt: now, title: "[expired]", summary: null, primaryContext: null } }),
      ]);
      out.conversations += 1;
    }
    out.toolResults += (await prisma.aiCopilotToolResult.deleteMany({ where: { organizationId, OR: [{ expiresAt: { lt: now } }, { createdAt: { lt: before(retention.copilotToolResultDays) } }] } })).count;
    const oldQueries = (await prisma.aiRetrievalQuery.findMany({ where: { organizationId, createdAt: { lt: before(retention.retrievalLogDays) } }, select: { id: true }, take: 2000 })).map((q) => q.id);
    if (oldQueries.length) {
      await prisma.aiRetrievalResult.deleteMany({ where: { queryId: { in: oldQueries } } });
      out.retrievalLogs += (await prisma.aiRetrievalQuery.deleteMany({ where: { id: { in: oldQueries } } })).count;
    }
  }
  return out;
}

// Every few seconds: queued indexing jobs.
export async function runCopilotIndexing() {
  return runIndexingJobs({ max: 25 });
}

let lastSweep = 0;
export async function runCopilotMaintenance(now = new Date()) {
  const results = {};
  const jobs = { staleMessages: failStaleCopilotMessages, workflowRuns: expireWorkflowRuns, memories: () => expireMemories(undefined, now), retention: applyCopilotRetention };
  if (now - lastSweep > 60 * 60_000) { jobs.indexSweep = () => sweepIndex(); lastSweep = now.getTime(); }
  for (const [name, fn] of Object.entries(jobs)) {
    try { results[name] = await fn(now); } catch (err) { results[name] = `error: ${err.message}`; }
  }
  return results;
}