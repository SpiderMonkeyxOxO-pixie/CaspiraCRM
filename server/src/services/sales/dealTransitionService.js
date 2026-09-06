// Deal lifecycle rules — the ONE place that decides whether a Stage change
// is allowed. Used by both the Kanban drag-and-drop endpoint and the detail
// form's transition action (there is only one transition endpoint; this
// service is what it calls), so the two surfaces can never diverge.
//
// The backend never automatically marks a Deal Won or Lost — every call
// into this service originates from an explicit, human-initiated request.

// A Stage's `classification` (Open|Won|Lost|Cancelled|OnHold) drives every
// rule below — never a hardcoded stage name, so a renamed or reconfigured
// Stage keeps working correctly.
export function validateTransition({ deal, fromStage, toStage, toPipeline, reason, actualClosingDate, reopenReason }) {
  const errors = [];

  const fromClassification = fromStage?.classification || "Open";
  const isCrossPipeline = toPipeline && deal.pipelineId && toPipeline.id !== deal.pipelineId;

  // Moving between Pipelines requires the caller to explicitly pick the
  // destination Stage themselves (an explicit "Stage mapping") — this
  // function only re-affirms that a destination Stage was actually
  // supplied and belongs to the destination Pipeline; the controller is
  // responsible for verifying toStage.pipelineId === toPipeline.id before
  // calling this at all.
  if (isCrossPipeline && !toStage) {
    errors.push({ code: "SALES_INVALID_TRANSITION", message: "Moving a Deal to a different Pipeline requires an explicit destination Stage." });
  }

  // A closed Deal (Won/Lost/Cancelled) cannot move to an Open Stage without
  // going through the dedicated reopen action (which requires its own
  // permission + reason) — this function only validates ordinary
  // transitions; reopen is validated separately by validateReopen().
  if (["Won", "Lost", "Cancelled"].includes(fromClassification) && toStage?.classification === "Open") {
    errors.push({ code: "SALES_INVALID_TRANSITION", message: "A closed Deal cannot be moved back to an Open Stage directly — use reopen." });
  }

  if (toStage?.classification === "Won" && !actualClosingDate && !deal.actualClosingDate) {
    errors.push({ code: "SALES_VALIDATION_FAILED", message: "Marking a Deal Won requires an actual close date." });
  }
  if (toStage?.classification === "Lost" && !reason?.trim()) {
    errors.push({ code: "SALES_VALIDATION_FAILED", message: "Marking a Deal Lost requires a loss reason." });
  }
  if (toStage?.classification === "Cancelled" && !reason?.trim()) {
    errors.push({ code: "SALES_VALIDATION_FAILED", message: "Cancelling a Deal requires a reason." });
  }
  if (toStage?.classification === "OnHold" && !reason?.trim()) {
    errors.push({ code: "SALES_VALIDATION_FAILED", message: "Placing a Deal on hold requires a reason." });
  }

  // Required-field enforcement per Stage (entry rules) — a Stage can
  // declare `requiredFields` (e.g. ["primaryContactId"]); the backend
  // enforces these, not just the frontend form.
  for (const field of toStage?.requiredFields || []) {
    if (!deal[field]) errors.push({ code: "SALES_VALIDATION_FAILED", message: `"${field}" is required to enter the "${toStage.name}" stage.` });
  }

  return errors;
}

export function validateReopen({ deal, reason }) {
  const errors = [];
  if (!["Won", "Lost", "Cancelled"].includes(deal.status) && deal.status !== "On Hold") {
    errors.push({ code: "SALES_INVALID_TRANSITION", message: "Only a Won, Lost, Cancelled, or On Hold Deal can be reopened." });
  }
  if (!reason?.trim()) errors.push({ code: "SALES_VALIDATION_FAILED", message: "Reopening a Deal requires a reason." });
  return errors;
}

// Maps a Stage classification to the coarse Deal.status the frontend's
// DEAL_STATUSES vocabulary expects — never the legacy "Closed Won"/"Closed
// Lost" strings a prior version of this backend used.
export function statusForClassification(classification) {
  if (classification === "Won") return "Won";
  if (classification === "Lost") return "Lost";
  if (classification === "Cancelled") return "Cancelled";
  if (classification === "OnHold") return "On Hold";
  return "Open";
}
