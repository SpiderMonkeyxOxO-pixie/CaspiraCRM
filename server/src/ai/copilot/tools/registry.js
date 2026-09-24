// Backend Phase 10 — the Copilot tool registry (version 1). Allowlisted,
// versioned, strict schemas. Read tools call the EXISTING domain handlers
// with the user's own identity, so organization, record scope and field
// masking are the same as in the app; the user's grant for the module is
// checked first. Organization, user, owner and team never come from the
// model — "mine" is a boolean the server turns into the caller's membership.
// Proposal tools only create Phase 9 governed-action previews.
import { z } from "zod";
import { hasGrant } from "../../../utils/grants.js";
import { callHandler } from "../../actions/actionTypes.js";
import { shapeRecord } from "../evidence.js";
import * as leads from "../../../controllers/crm/leadsController.js";
import * as contacts from "../../../controllers/crm/contactsController.js";
import * as companies from "../../../controllers/crm/companiesController.js";
import * as activities from "../../../controllers/crm/activitiesController.js";
import * as deals from "../../../controllers/sales/dealsController.js";
import * as quotes from "../../../controllers/sales/quotesController.js";
import * as orders from "../../../controllers/sales/ordersController.js";
import * as contracts from "../../../controllers/sales/contractsController.js";
import * as salesReports from "../../../controllers/sales/reportsController.js";
import * as tickets from "../../../controllers/support/ticketsController.js";
import * as kb from "../../../controllers/support/knowledgeBaseController.js";
import * as projects from "../../../controllers/projects/projectsController.js";
import * as tasks from "../../../controllers/projects/tasksController.js";
import * as invoices from "../../../controllers/finance/invoicesController.js";

export const TOOL_REGISTRY_VERSION = "1";
export const MAX_RECORDS_PER_TOOL = 25;

const id = z.string().min(1).max(64);
const text = z.string().max(120).optional();
const limit = z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).optional();
const bool = z.boolean().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional();

export class ToolDenied extends Error {
  constructor(message, { status = "Denied", reason = "denied" } = {}) { super(message); this.status = status; this.reason = reason; }
}

// Runs a list handler and shapes its records.
async function listVia(req, handler, key, recordType, query, max = MAX_RECORDS_PER_TOOL) {
  const out = await callHandler(handler, req, { query: { pageSize: String(Math.min(max, MAX_RECORDS_PER_TOOL)), ...Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")) } });
  if (out.status !== 200) throw new ToolDenied(out.body?.message || `The ${recordType} list isn't available to you.`, { reason: `handler_${out.status}` });
  const rows = out.body?.[key] || [];
  return { records: rows.slice(0, max).map((r) => shapeRecord(recordType, r)), total: out.body?.total ?? rows.length, truncated: (out.body?.total ?? rows.length) > Math.min(rows.length, max) };
}

async function getVia(req, handler, paramName, key, recordType, recordId) {
  const out = await callHandler(handler, req, { params: { [paramName]: recordId } });
  if (out.status === 404 || out.status === 403) throw new ToolDenied(`That ${recordType} wasn't found, or you can't open it.`, { reason: "not_found" });
  if (out.status !== 200) throw new ToolDenied(out.body?.message || `The ${recordType} isn't available.`, { reason: `handler_${out.status}` });
  return { records: [shapeRecord(recordType, out.body[key])], total: 1, truncated: false };
}

const me = (req) => req.membership?.id || "none";

// name: { description, schema, grant: [module, action], sensitive, kind, run(req, input) }
export const TOOLS = {
  get_current_user_scope: {
    description: "What the current user can see in the CRM (modules and scope). No records.", kind: "read", grant: null,
    schema: z.object({}).strict(),
    async run(req) {
      const modules = ["leads", "contacts", "companies", "deals", "activities", "quotes", "orders", "contracts", "tickets", "knowledge_base", "projects", "tasks", "invoices"].filter((m) => hasGrant(req, m, "view"));
      return { records: [], total: 0, truncated: false, info: { modules, sensitiveFinance: hasGrant(req, "ai_copilot_tools", "view_sensitive_fields") } };
    },
  },
  search_leads: {
    description: "Search Leads (name/company/email). Filters: status, followUpOverdue, mine.", kind: "read", grant: ["leads", "view"],
    schema: z.object({ query: text, status: text, followUpOverdue: bool, mine: bool, limit }).strict(),
    run: (req, i) => listVia(req, leads.list, "leads", "Lead", { search: i.query, status: i.status, followUpOverdue: i.followUpOverdue ? "true" : undefined, ownerMembershipId: i.mine ? me(req) : undefined }, i.limit),
  },
  get_lead: { description: "One Lead by id.", kind: "read", grant: ["leads", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, leads.getOne, "leadId", "lead", "Lead", i.id) },
  search_contacts: {
    description: "Search Contacts. Filters: companyId, followUpOverdue, mine.", kind: "read", grant: ["contacts", "view"],
    schema: z.object({ query: text, companyId: id.optional(), followUpOverdue: bool, mine: bool, limit }).strict(),
    run: (req, i) => listVia(req, contacts.list, "contacts", "Contact", { search: i.query, companyId: i.companyId, followUpOverdue: i.followUpOverdue ? "true" : undefined, ownerMembershipId: i.mine ? me(req) : undefined }, i.limit),
  },
  get_contact: { description: "One Contact by id.", kind: "read", grant: ["contacts", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, contacts.getOne, "contactId", "contact", "Contact", i.id) },
  search_companies: {
    description: "Search Companies by name. Filters: lifecycleStage, mine.", kind: "read", grant: ["companies", "view"],
    schema: z.object({ query: text, lifecycleStage: text, mine: bool, limit }).strict(),
    run: (req, i) => listVia(req, companies.list, "companies", "Company", { search: i.query, lifecycleStage: i.lifecycleStage, ownerMembershipId: i.mine ? me(req) : undefined }, i.limit),
  },
  get_company: { description: "One Company by id.", kind: "read", grant: ["companies", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, companies.getOne, "companyId", "company", "Company", i.id) },
  search_deals: {
    description: "Search Deals. Filters: status (Open/Won/Lost), companyId, noNextAction, passedExpectedClose, closingFrom/To (YYYY-MM-DD), mine.", kind: "read", grant: ["deals", "view"],
    schema: z.object({ query: text, status: text, companyId: id.optional(), noNextAction: bool, passedExpectedClose: bool, closingFrom: date, closingTo: date, mine: bool, limit }).strict(),
    run: (req, i) => listVia(req, deals.list, "deals", "Deal", { search: i.query, status: i.status, companyId: i.companyId, noNextAction: i.noNextAction ? "true" : undefined, passedExpectedClose: i.passedExpectedClose ? "true" : undefined, closingFrom: i.closingFrom, closingTo: i.closingTo, ownerMembershipId: i.mine ? me(req) : undefined }, i.limit),
  },
  get_deal: { description: "One Deal by id.", kind: "read", grant: ["deals", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, deals.getOne, "dealId", "deal", "Deal", i.id) },
  get_pipeline_metrics: {
    description: "Deterministic pipeline totals for the Deals you can see: open and weighted pipeline, stage totals, win rate, owner workload, concentration. Optional from/to for won/lost. scope 'organization' needs confirmation.",
    kind: "read", grant: ["sales_reports", "view"], deterministic: true,
    schema: z.object({ from: date, to: date, scope: z.enum(["mine", "organization"]).optional() }).strict(),
    needsConfirmation: (req, i) => i.scope === "organization" ? "Organization-wide pipeline figures" : null,
    async run(req, i) {
      const out = await callHandler(salesReports.pipelineSummary, req, { query: { from: i.from, to: i.to } });
      if (out.status !== 200) throw new ToolDenied(out.body?.message || "Pipeline figures aren't available to you.");
      const { byStage, byOwner, concentrationByCompany, ...totals } = out.body;
      return {
        records: [{ recordType: "PipelineMetrics", recordId: `pipeline:${i.from || "all"}:${i.to || "now"}`, label: "Pipeline summary (deterministic)", route: "/sales/reports", updatedAt: new Date().toISOString(), sourceVersion: "computed", fields: { ...totals, byStage: JSON.stringify(byStage).slice(0, 1500), byOwner: JSON.stringify(byOwner).slice(0, 800), concentrationByCompany: JSON.stringify(concentrationByCompany).slice(0, 800) }, masked: [] }],
        total: 1, truncated: false,
      };
    },
  },
  search_activities: {
    description: "Search Activities. Filters: overdue, upcoming, mine, companyId, contactId, dueFrom/dueTo.", kind: "read", grant: ["activities", "view"],
    schema: z.object({ query: text, overdue: bool, upcoming: bool, mine: bool, companyId: id.optional(), contactId: id.optional(), dueFrom: date, dueTo: date, limit }).strict(),
    run: (req, i) => listVia(req, activities.list, "activities", "Activity", { search: i.query, overdue: i.overdue ? "true" : undefined, upcoming: i.upcoming ? "true" : undefined, ownerMembershipId: i.mine ? me(req) : undefined, companyId: i.companyId, contactId: i.contactId, dueFrom: i.dueFrom, dueTo: i.dueTo, sort: "dueDate", order: "asc" }, i.limit),
  },
  get_overdue_activities: {
    description: "Deterministic list of overdue Activities (yours by default).", kind: "read", grant: ["activities", "view"], deterministic: true,
    schema: z.object({ mine: bool, limit }).strict(),
    run: (req, i) => listVia(req, activities.list, "activities", "Activity", { overdue: "true", ownerMembershipId: i.mine === false ? undefined : me(req), sort: "dueDate", order: "asc" }, i.limit),
  },
  search_quotes: {
    description: "Search Quotes. Filters: status, companyId, dealId.", kind: "read", grant: ["quotes", "view"],
    schema: z.object({ query: text, status: text, companyId: id.optional(), dealId: id.optional(), limit }).strict(),
    run: (req, i) => listVia(req, quotes.list, "quotes", "Quote", { search: i.query, status: i.status, companyId: i.companyId, dealId: i.dealId }, i.limit),
  },
  get_quote: { description: "One Quote by id.", kind: "read", grant: ["quotes", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, quotes.getOne, "quoteId", "quote", "Quote", i.id) },
  search_orders: {
    description: "Search Orders. Filters: status, companyId.", kind: "read", grant: ["orders", "view"],
    schema: z.object({ query: text, status: text, companyId: id.optional(), limit }).strict(),
    run: (req, i) => listVia(req, orders.list, "orders", "Order", { search: i.query, status: i.status, companyId: i.companyId }, i.limit),
  },
  get_order: { description: "One Order by id.", kind: "read", grant: ["orders", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, orders.getOne, "orderId", "order", "Order", i.id) },
  search_contracts: {
    description: "Search Contracts. Filters: status, companyId, expiringWithinDays (deterministic end-date window).", kind: "read", grant: ["contracts", "view"],
    schema: z.object({ query: text, status: text, companyId: id.optional(), expiringWithinDays: z.number().int().min(1).max(730).optional(), limit }).strict(),
    async run(req, i) {
      const out = await listVia(req, contracts.list, "contracts", "Contract", { search: i.query, status: i.status, companyId: i.companyId }, i.expiringWithinDays ? MAX_RECORDS_PER_TOOL : i.limit);
      if (!i.expiringWithinDays) return out;
      const horizon = Date.now() + i.expiringWithinDays * 86_400_000;
      const endOf = (r) => r.fields.endDate || r.fields.expiryDate || r.fields.renewalDate;
      const within = out.records.filter((r) => endOf(r) && new Date(endOf(r)).getTime() <= horizon && new Date(endOf(r)).getTime() >= Date.now() - 86_400_000);
      within.sort((a, b) => new Date(endOf(a)) - new Date(endOf(b)));
      return { records: within.slice(0, i.limit || MAX_RECORDS_PER_TOOL), total: within.length, truncated: out.truncated, deterministic: true };
    },
  },
  get_contract: { description: "One Contract by id.", kind: "read", grant: ["contracts", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, contracts.getOne, "contractId", "contract", "Contract", i.id) },
  search_support_tickets: {
    description: "Search Support Tickets. Filters: open, assignedToMe.", kind: "read", grant: ["tickets", "view"],
    schema: z.object({ query: text, open: bool, assignedToMe: bool, limit }).strict(),
    run: (req, i) => listVia(req, tickets.list, "tickets", "Ticket", { search: i.query, open: i.open ? "true" : undefined, assignedMembershipId: i.assignedToMe ? me(req) : undefined }, i.limit),
  },
  get_support_ticket: { description: "One Ticket by id.", kind: "read", grant: ["tickets", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, tickets.getOne, "ticketId", "ticket", "Ticket", i.id) },
  search_projects: {
    description: "Search Projects.", kind: "read", grant: ["projects", "view"],
    schema: z.object({ query: text, limit }).strict(),
    run: (req, i) => listVia(req, projects.list, "projects", "Project", { search: i.query }, i.limit),
  },
  get_project: { description: "One Project by id.", kind: "read", grant: ["projects", "view"], schema: z.object({ id }).strict(), run: (req, i) => getVia(req, projects.getOne, "projectId", "project", "Project", i.id) },
  search_tasks: {
    description: "Search project Tasks. Filters: assignedToMe, blocked.", kind: "read", grant: ["tasks", "view"],
    schema: z.object({ query: text, assignedToMe: bool, blocked: bool, limit }).strict(),
    run: (req, i) => listVia(req, tasks.list, "tasks", "Task", { search: i.query, assigneeMembershipId: i.assignedToMe ? me(req) : undefined, blocked: i.blocked ? "true" : undefined }, i.limit),
  },
  search_invoices: {
    description: "Search Invoices (sensitive Finance data — needs the user's confirmation). Filters: status, companyId.", kind: "read", grant: ["invoices", "view"], sensitive: true,
    schema: z.object({ query: text, status: text, companyId: id.optional(), limit }).strict(),
    needsConfirmation: () => "Finance data (invoices)",
    run: (req, i) => listVia(req, invoices.list, "invoices", "Invoice", { search: i.query, status: i.status, companyId: i.companyId }, i.limit),
  },
  search_knowledge_base: {
    description: "Search published Knowledge Base articles (keyword; semantic matches are added automatically).", kind: "read", grant: ["knowledge_base", "view"],
    schema: z.object({ query: z.string().min(1).max(120), limit }).strict(),
    run: (req, i) => listVia(req, kb.listArticles, "articles", "KnowledgeArticle", { search: i.query, status: "Published" }, i.limit || 10),
  },
  search_documents: {
    description: "Documents — not available until the Documents phase is implemented.", kind: "read", grant: null, unavailable: "Documents require Backend Phase 7, which isn't implemented.",
    schema: z.object({ query: text }).strict(), run: async () => ({ records: [], total: 0, truncated: false }),
  },
  get_document_excerpt: {
    description: "Document excerpts — not available until the Documents phase is implemented.", kind: "read", grant: null, unavailable: "Documents require Backend Phase 7, which isn't implemented.",
    schema: z.object({ id }).strict(), run: async () => ({ records: [], total: 0, truncated: false }),
  },
};

// Proposal tools → Phase 9 governed actions (preview only).
const target = z.object({ targetType: z.enum(["Deal", "Lead", "Contact", "Company"]), targetId: id });
export const PROPOSAL_TOOLS = {
  propose_create_follow_up: { actionType: "create_follow_up", schema: target.extend({ subject: z.string().max(200).optional(), dueDate: date }).strict() },
  propose_schedule_meeting: { actionType: "schedule_meeting", schema: target.extend({ subject: z.string().max(200).optional(), dueDate: date, location: z.string().max(200).optional() }).strict() },
  propose_assign_owner: { actionType: "assign_owner", schema: target.extend({ ownerMembershipId: id }).strict() },
  propose_update_expected_close_date: { actionType: "update_expected_close_date", schema: target.extend({ expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict() },
  propose_add_next_action: { actionType: "add_next_action", schema: target.extend({ nextAction: z.string().min(1).max(500) }).strict() },
  propose_create_deal: { actionType: "create_deal", schema: target.extend({ name: z.string().max(200).optional(), value: z.number().min(0).optional(), expectedCloseDate: date }).strict() },
  propose_request_missing_information: { actionType: "request_missing_information", schema: target.extend({ subject: z.string().max(200).optional() }).strict() },
  propose_start_renewal_review: { actionType: "create_follow_up", schema: target.extend({ subject: z.string().max(200).optional(), dueDate: date }).strict() },
  propose_review_duplicate: { actionType: "merge", schema: target.strict() }, // always refused: merging is manual
  propose_open_records: { actionType: null, schema: z.object({ records: z.array(z.object({ recordType: z.string().max(40), recordId: id })).max(10) }).strict() },
};

// Catalog handed to the model (names, descriptions, argument shapes).
export function toolCatalogForModel(req) {
  const read = Object.entries(TOOLS)
    .filter(([, t]) => !t.grant || hasGrant(req, t.grant[0], t.grant[1]))
    .map(([name, t]) => ({ name, description: t.unavailable ? `${t.description}` : t.description, arguments: Object.keys(t.schema.shape || {}) }));
  const propose = Object.keys(PROPOSAL_TOOLS).map((name) => ({ name, description: `Proposal only — a person must confirm. Arguments: ${Object.keys(PROPOSAL_TOOLS[name].schema.shape || {}).join(", ")}` }));
  return { read, propose };
}

// Policy check for one requested read tool → { tool, input } or throws ToolDenied.
export function authorizeToolCall(req, name, rawInput) {
  const tool = TOOLS[name];
  if (!tool) throw new ToolDenied(`"${String(name).slice(0, 60)}" isn't an allowed Copilot tool.`, { reason: "not_allowlisted" });
  if (!hasGrant(req, "ai_copilot_tools", "view")) throw new ToolDenied("Your role can't use Copilot data tools.", { reason: "no_tool_grant" });
  if (tool.grant && !hasGrant(req, tool.grant[0], tool.grant[1])) throw new ToolDenied(`You don't have access to ${tool.grant[0].replace(/_/g, " ")}.`, { reason: "no_module_grant" });
  if (tool.sensitive && !hasGrant(req, "ai_copilot_tools", "view_sensitive_fields")) throw new ToolDenied("This needs sensitive-data access, which your role doesn't have.", { reason: "no_sensitive_grant" });
  // Identity fields are never accepted from the model.
  const cleaned = Object.fromEntries(Object.entries(rawInput || {}).filter(([k]) => !/organi[sz]ation|membership|userId|owner(Id|MembershipId)|tenant|team|department/i.test(k)));
  const parsed = tool.schema.safeParse(cleaned);
  if (!parsed.success) throw new ToolDenied(`Invalid arguments for ${name}: ${parsed.error.issues[0]?.message || "invalid"}.`, { reason: "invalid_input" });
  return { tool, input: parsed.data, confirmation: tool.needsConfirmation?.(req, parsed.data) || null };
}
