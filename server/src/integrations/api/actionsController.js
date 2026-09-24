// Backend Phase 8 — explicit provider actions (preview → confirm).
import prisma from "../../lib/prisma.js";
import { IntegrationError, sendIntegrationError } from "../common/errors.js";
import { loadConnection } from "../connections/connectionService.js";
import { previewAction, executeAction, ACTIONS } from "../actions/actionService.js";

const guard = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err instanceof IntegrationError) return sendIntegrationError(res, err);
    return next(err);
  }
};
const notFound = (res) => res.status(404).json({ code: "INTEGRATION_NOT_FOUND", message: "Connection not found." });

// The prepared payload (a draft's recipients and body, a message's headers)
// is shown only to the person who prepared it.
const serializeAction = (req) => (r) => {
  const own = r.initiatedByMembershipId && r.initiatedByMembershipId === req.membership?.id;
  return {
    _id: r.id, connectionId: r.connectionId, capability: r.capability, kind: r.preview?.kind || null, status: r.status,
    preview: own ? { payload: r.preview?.payload, warnings: r.preview?.warnings || [], notes: r.preview?.notes || [] } : undefined,
    result: r.status === "Completed" ? r.preview?.result || null : null,
    previewExpiresAt: r.previewExpiresAt, confirmedAt: r.confirmedAt, initiatedByMembershipId: r.initiatedByMembershipId,
    errorCode: r.errorCode, errorMessage: r.errorMessage, createdAt: r.createdAt,
  };
};

export const listActions = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res);
  const runs = await prisma.integrationSyncRun.findMany({ where: { connectionId: connection.id, kind: "Action Preview" }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ actions: runs.map(serializeAction(req)), available: Object.keys(ACTIONS) });
});

export const previewActionHandler = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res);
  const run = await previewAction(req, connection, { capability: req.body?.capability, input: req.body?.input || {} });
  res.status(201).json({ action: serializeAction(req)(run), note: "Nothing has been sent. Review, then confirm." });
});

export const executeActionHandler = guard(async (req, res) => {
  const connection = await loadConnection(req, req.params.connectionId);
  if (!connection) return notFound(res);
  const run = await executeAction(req, connection, { previewRunId: req.body?.previewRunId, confirm: req.body?.confirm });
  res.json({ action: serializeAction(req)(run) });
});
