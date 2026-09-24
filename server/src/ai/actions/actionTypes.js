// Backend Phase 9 — governed AI action types. Each allowed type knows:
//   - the target it acts on and the CRM grant it needs,
//   - how to validate the proposed values,
//   - how to execute through the EXISTING domain handler (the same code,
//     scope rules, validation and audit a person's click would use),
//   - whether and how it can be undone.
// Nothing here is reachable from a model call alone: the action service
// requires a preview, a human confirmation and, when policy says so, an
// approver.
import * as activities from "../../controllers/crm/activitiesController.js";
import * as deals from "../../controllers/sales/dealsController.js";
import { AiError, CATEGORIES } from "../common/errors.js";

// Runs an existing Express handler in-process with the caller's identity.
export async function callHandler(handler, req, { params = {}, body = {}, query = {} } = {}) {
  const sub = Object.assign(Object.create(req), { params, body: { ...body, organizationId: req.organizationId }, query: { ...query, organizationId: req.organizationId } });
  let status = 200;
  let payload = null;
  const res = { status(c) { status = c; return res; }, json(p) { payload = p; return res; }, set() { return res; }, send(p) { payload = p; return res; } };
  await handler(sub, res);
  return { status, body: payload };
}

const fail = (out, what) => new AiError(out.status === 409 ? CATEGORIES.INVALID_REQUEST : out.status === 404 ? CATEGORIES.PERMISSION : CATEGORIES.INVALID_REQUEST, out.body?.message || `${what} failed.`, { details: { status: out.status, code: out.body?.code } });

const str = (v, max = 200) => (v === undefined || v === null ? null : String(v).trim().slice(0, max));
const dateOrNull = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); };

const RELATED_FIELD = { Lead: "leadId", Contact: "contactId", Company: "companyId", Deal: "dealId" };

// Loads the target through the domain handler, so the proposer's scope applies.
export async function loadTarget(req, targetType, targetId) {
  if (targetType === "Deal") {
    const out = await callHandler(deals.getOne, req, { params: { dealId: targetId } });
    if (out.status !== 200) throw new AiError(CATEGORIES.PERMISSION, "That Deal wasn't found, or you can't open it.");
    const d = out.body.deal;
    return { record: d, version: d.version ?? null, label: d.name, current: { name: d.name, nextAction: d.nextAction ?? null, expectedClosingDate: d.expectedClosingDate ?? null, ownerMembershipId: d.ownerMembershipId ?? null, stage: d.stage ?? null } };
  }
  const model = { Lead: "lead", Contact: "contact", Company: "company" }[targetType];
  if (!model) throw new AiError(CATEGORIES.INVALID_REQUEST, "Unsupported target type.");
  // Leads, Contacts and Companies: the proposer must be able to see the
  // record through the activity it will be linked to (organization check;
  // record scope is enforced again by the activity handler on execution).
  const { default: prisma } = await import("../../lib/prisma.js");
  const r = await prisma[model].findFirst({ where: { id: targetId, organizationId: req.organizationId }, select: { id: true, name: true, ownerMembershipId: true } });
  if (!r) throw new AiError(CATEGORIES.PERMISSION, `That ${targetType} wasn't found, or you can't open it.`);
  return { record: r, version: null, label: r.name, current: { name: r.name, ownerMembershipId: r.ownerMembershipId ?? null } };
}

function activityType({ title, type, priority }) {
  return {
    targets: ["Lead", "Contact", "Company", "Deal"], grant: ["activities", "create"], defaultApproval: false,
    validate(values, target) {
      const t = str(values.subject || values.title, 200) || title(target);
      const due = dateOrNull(values.dueDate || values.scheduledStart);
      if (due === undefined) throw new AiError(CATEGORIES.INVALID_REQUEST, "The date isn't valid.");
      return { title: t, dueDate: due || new Date(Date.now() + 2 * 86_400_000).toISOString(), description: str(values.description || values.agenda, 2000), ...(type === "Meeting" && { scheduledStart: due || null, scheduledEnd: dateOrNull(values.scheduledEnd) || null, location: str(values.location, 200) }) };
    },
    async execute(req, p) {
      const body = { title: p.proposedValues.title, type, priority, description: p.proposedValues.description || null, dueDate: p.proposedValues.dueDate, [RELATED_FIELD[p.targetType]]: p.targetId, source: "AI proposal (confirmed)", ...(type === "Meeting" && { scheduledStart: p.proposedValues.scheduledStart || p.proposedValues.dueDate, scheduledEnd: p.proposedValues.scheduledEnd, location: p.proposedValues.location }) };
      const out = await callHandler(activities.create, req, { body });
      if (out.status !== 201) throw fail(out, "Creating the activity");
      return { result: { activityId: out.body.activity._id || out.body.activity.id }, undo: { activityId: out.body.activity._id || out.body.activity.id } };
    },
    async undo(req, p) {
      const out = await callHandler(activities.cancel, req, { params: { activityId: p.undoData.activityId }, body: { reason: "Undone from the AI action proposal" } });
      if (out.status !== 200) throw fail(out, "Undoing the activity");
    },
  };
}

export const ACTION_TYPES = {
  create_follow_up: { label: "Create follow-up Activity", ...activityType({ type: "Task", priority: "Medium", title: (t) => `Follow up: ${t.label}` }) },
  // Creates a Meeting activity. No invitation is sent to anyone.
  schedule_meeting: { label: "Schedule meeting (no invitation is sent)", ...activityType({ type: "Meeting", priority: "Medium", title: (t) => `Meeting: ${t.label}` }) },
  // Creates an internal task; nothing is sent outside the CRM.
  request_missing_information: { label: "Request missing information (internal task)", ...activityType({ type: "Task", priority: "Low", title: (t) => `Missing information: ${t.label}` }) },
  add_next_action: {
    label: "Add next action", targets: ["Deal"], grant: ["deals", "edit"], defaultApproval: false,
    validate(values) {
      const v = str(values.nextAction, 500);
      if (!v) throw new AiError(CATEGORIES.INVALID_REQUEST, "Enter the next action.");
      return { nextAction: v };
    },
    async execute(req, p) {
      const out = await callHandler(deals.update, req, { params: { dealId: p.targetId }, body: { nextAction: p.proposedValues.nextAction, version: p.targetVersion } });
      if (out.status !== 200) throw fail(out, "Updating the Deal");
      return { result: { dealId: p.targetId, version: out.body.deal.version }, undo: { nextAction: p.currentValues.nextAction ?? null, version: out.body.deal.version } };
    },
    async undo(req, p) {
      const out = await callHandler(deals.update, req, { params: { dealId: p.targetId }, body: { nextAction: p.undoData.nextAction, version: p.undoData.version } });
      if (out.status !== 200) throw fail(out, "Undoing the Deal change");
    },
  },
  update_expected_close_date: {
    label: "Update expected close date", targets: ["Deal"], grant: ["deals", "edit"], defaultApproval: false,
    validate(values) {
      const d = dateOrNull(values.expectedCloseDate || values.expectedClosingDate);
      if (!d) throw new AiError(CATEGORIES.INVALID_REQUEST, "Enter a valid expected close date.");
      return { expectedClosingDate: d };
    },
    async execute(req, p) {
      const out = await callHandler(deals.update, req, { params: { dealId: p.targetId }, body: { expectedClosingDate: p.proposedValues.expectedClosingDate, version: p.targetVersion } });
      if (out.status !== 200) throw fail(out, "Updating the Deal");
      return { result: { dealId: p.targetId, version: out.body.deal.version }, undo: { expectedClosingDate: p.currentValues.expectedClosingDate ?? null, version: out.body.deal.version } };
    },
    async undo(req, p) {
      const out = await callHandler(deals.update, req, { params: { dealId: p.targetId }, body: { expectedClosingDate: p.undoData.expectedClosingDate, version: p.undoData.version } });
      if (out.status !== 200) throw fail(out, "Undoing the Deal change");
    },
  },
  assign_owner: {
    label: "Assign owner", targets: ["Deal"], grant: ["deals", "assign"], defaultApproval: true,
    validate(values) {
      const id = str(values.ownerMembershipId, 64);
      if (!id) throw new AiError(CATEGORIES.INVALID_REQUEST, "Choose the new owner.");
      return { ownerMembershipId: id };
    },
    async execute(req, p) {
      const out = await callHandler(deals.assign, req, { params: { dealId: p.targetId }, body: { ownerMembershipId: p.proposedValues.ownerMembershipId } });
      if (out.status !== 200) throw fail(out, "Assigning the Deal");
      return { result: { dealId: p.targetId }, undo: { ownerMembershipId: p.currentValues.ownerMembershipId ?? null } };
    },
    async undo(req, p) {
      if (!p.undoData.ownerMembershipId) throw new AiError(CATEGORIES.INVALID_REQUEST, "The Deal had no owner before, so there's nothing to restore.");
      const out = await callHandler(deals.assign, req, { params: { dealId: p.targetId }, body: { ownerMembershipId: p.undoData.ownerMembershipId } });
      if (out.status !== 200) throw fail(out, "Restoring the owner");
    },
  },
  create_deal: {
    label: "Create Deal", targets: ["Company", "Lead", "Contact"], grant: ["deals", "create"], defaultApproval: true,
    validate(values, target) {
      const name = str(values.name, 200) || `${target.label} — new opportunity`;
      const value = values.value === undefined || values.value === null ? undefined : Number(values.value);
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new AiError(CATEGORIES.INVALID_REQUEST, "The value must be a positive number.");
      const d = dateOrNull(values.expectedCloseDate || values.expectedClosingDate);
      if (d === undefined) throw new AiError(CATEGORIES.INVALID_REQUEST, "The expected close date isn't valid.");
      return { name, ...(value !== undefined && { value }), ...(d && { expectedClosingDate: d }), ...(values.currency && { currency: str(values.currency, 3).toUpperCase() }) };
    },
    async execute(req, p) {
      const body = { ...p.proposedValues, ...(p.targetType === "Company" && { companyId: p.targetId }), ...(p.targetType === "Contact" && { primaryContactId: p.targetId }), source: "AI proposal (confirmed)" };
      const out = await callHandler(deals.create, req, { body });
      if (out.status !== 201) throw fail(out, "Creating the Deal");
      return { result: { dealId: out.body.deal._id || out.body.deal.id }, undo: null };
    },
    // No automatic undo: removing a Deal is an archive, which people do from the Deal page.
  },
};

// Never executed — explained instead.
export const PROHIBITED = {
  delete: ["Deleting records", "people with the module's delete permission, from the record page"],
  archive: ["Archiving records", "people with the module's archive permission, from the record page"],
  merge: ["Merging duplicates", "people with the merge permission, through Duplicates review"],
  send_email: ["Sending email", "the record owner, from their own mailbox or the Activities composer"],
  send_sms: ["Sending SMS", "the record owner, through the organization's messaging tools"],
  send_message: ["Sending chat messages", "the record owner, through the organization's messaging tools"],
  approve_quote: ["Approving Quotes", "Quote approvers, through the Quote approval workflow"],
  approve_discount: ["Approving discounts", "discount approvers, through the Quote approval workflow"],
  confirm_order: ["Confirming Orders", "people with orders:confirm, from the Order page"],
  activate_contract: ["Activating Contracts", "people with contracts:activate, from the Contract page"],
  post_invoice: ["Posting Invoices", "Finance Managers and Accountants, through the Finance posting queue"],
  process_payment: ["Processing payments", "Finance, through the Payments workflow"],
  refund: ["Issuing refunds", "Finance, through the credit note and payments workflow"],
  change_permissions: ["Changing permissions", "Organization Administrators, from Roles and Members"],
  sign_document: ["Signing documents", "the signer, through the signature workflow"],
  export_data: ["Exporting unrestricted datasets", "people with the export permission, through the module's export"],
  hr_decision: ["HR disciplinary decisions", "HR, through the organization's HR process"],
};

export const PROHIBITED_ALIASES = {
  delete_record: "delete", archive_record: "archive", merge_duplicates: "merge", review_duplicate: "merge", email: "send_email",
  approve_quotes: "approve_quote", confirm_orders: "confirm_order", activate_contracts: "activate_contract", post: "post_invoice",
  pay: "process_payment", payment: "process_payment", export: "export_data",
};
