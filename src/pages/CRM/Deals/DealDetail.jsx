import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Pencil, PhoneCall, CalendarClock, Trophy, XCircle, PauseCircle, RefreshCcw, Archive,
  RotateCcw, Shield, Plus, Trash2, Star, UserMinus, Upload, FileText, CheckCircle2, Circle,
} from "lucide-react";
import {
  fetchDeal, restoreDeal,
  addDealContact, updateDealContactRole, removeDealContact, setDealPrimaryContact,
  setDealLineItems, uploadDealFile, deleteDealFile,
  DEAL_CONTACT_ROLES, DEAL_CONTACT_INFLUENCE_LEVELS, DEAL_CONTACT_RELATIONSHIPS, DEAL_BILLING_FREQUENCIES,
  computeLineItemTotals,
} from "../../../redux/crm/dealsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchActivities, completeActivity } from "../../../redux/crm/activitiesSlice";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import DealFormModal from "./DealFormModal";
import StageProgress from "./StageProgress";
import { DealPriorityBadge, DealHealthBadge } from "./DealBadges";
import { MarkWonModal, MarkLostModal, CancelDealModal, PutOnHoldModal, ReopenDealModal, ArchiveDealModal } from "./DealOutcomeModals";
import { formatMoney, formatDate, formatDateTime, formatDuration } from "./dealUtils";
import { quotes } from "../../../Helpers/mockSalesData";
import { computeQuoteTotals, getEffectiveStatus as getQuoteEffectiveStatus } from "../../../Helpers/mockQuoteData";
import ActivityFormModal from "../Activities/ActivityFormModal";
import ActivityDetailDrawer from "../Activities/ActivityDetailDrawer";
import { TypeIcon, StatusBadge } from "../Activities/ActivityBadges";

const TABS = ["overview", "activities", "contacts", "products", "quotes", "stagehistory", "tasks", "files", "audit"];
const TAB_LABELS = {
  overview: "Overview", activities: "Activities", contacts: "Contacts", products: "Products", quotes: "Quotes",
  stagehistory: "Stage History", tasks: "Tasks", files: "Files", audit: "Audit",
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DealDetail() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const deal = useSelector((s) => s.deals.current);
  const notFound = useSelector((s) => s.deals.currentNotFound);
  const companies = useSelector((s) => s.companies.items);
  const contacts = useSelector((s) => s.contacts.items);
  const allActivities = useSelector((s) => s.activities.items);
  const role = useSelector((s) => s.auth.role);
  const isSuperAdmin = role === "Super-Admin";

  const [tab, setTab] = useState("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [action, setAction] = useState(null); // "won" | "lost" | "cancel" | "hold" | "reopen" | "archive" | "logActivity" | "followUp"
  const [drawerActivity, setDrawerActivity] = useState(null);
  const [editActivity, setEditActivity] = useState(null);

  useEffect(() => {
    dispatch(fetchDeal(id));
    dispatch(fetchCompanies());
    dispatch(fetchContacts({ pageSize: 1000 }));
    dispatch(fetchActivities());
  }, [dispatch, id]);

  if (notFound) {
    return (
      <div className="p-6 text-white max-w-lg">
        <p className="text-lg font-semibold mb-1">Deal not found</p>
        <p className="text-sm text-gray-400 mb-4">
          This deal doesn't exist or is no longer available. Since this environment persists data in memory only,
          a full page reload clears anything created during the session.
        </p>
        <Link to="/crm/deals" className="text-blue-400 hover:underline text-sm">Back to Deals</Link>
      </div>
    );
  }
  if (!deal) return <div className="p-6 text-gray-400">Loading deal...</div>;

  const company = companies.find((c) => c._id === deal.companyId);
  const primaryContact = contacts.find((c) => c._id === deal.primaryContactId);
  const isOpen = deal.status === "Open";
  const dealActivities = allActivities.filter((a) => a.relatedRecordType === "Deal" && a.relatedRecordId === deal._id);
  const overdueTasks = dealActivities.filter((a) => a.type === "Task" && !["Completed", "Cancelled"].includes(a.status) && a.dueDate && new Date(a.dueDate) < new Date());

  return (
    <div className="p-6 text-white max-w-6xl">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> /{" "}
        <Link to="/crm/deals" className="hover:text-gray-300">Deals</Link> / <span className="text-gray-300">{deal.name}</span>
      </nav>
      <Link to="/crm/deals" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 w-fit">
        <ArrowLeft size={16} /> Back to Deals
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold">{deal.name}{deal.archived && <span className="ml-2 text-sm text-gray-500 font-normal">(Archived)</span>}</h1>
          <p className="text-sm text-gray-400 mt-1">
            {company ? <Link to={`/crm/companies/${company._id}`} className="hover:underline">{company.name}</Link> : "No company"}
            {primaryContact && <> · <Link to={`/crm/contacts/${primaryContact._id}`} className="hover:underline">{primaryContact.name}</Link></>}
            {" · "}{formatMoney(deal.value, deal.currency)} · {deal.probability}% · Weighted {formatMoney(deal.weightedValue, deal.currency)}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Expected close {formatDate(deal.expectedClosingDate)} · Owner {deal.ownerName || "Unassigned"} ·{" "}
            <DealHealthBadge health={deal.dealHealth} reason={deal.healthReason} showReason />
          </p>
        </div>
        {!deal.archived && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowEdit(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Pencil size={14} /> Edit</button>
            <button onClick={() => setAction("logActivity")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><PhoneCall size={14} /> Log Activity</button>
            <button onClick={() => setAction("followUp")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><CalendarClock size={14} /> Create Follow-up</button>
            {isOpen && (
              <>
                <button onClick={() => setAction("won")} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 px-3 py-2 rounded-lg text-sm"><Trophy size={14} /> Mark Won</button>
                <button onClick={() => setAction("lost")} className="flex items-center gap-2 border border-red-700 text-red-400 hover:bg-red-900/30 px-3 py-2 rounded-lg text-sm"><XCircle size={14} /> Mark Lost</button>
                <button onClick={() => setAction("hold")} className="flex items-center gap-2 border border-orange-700 text-orange-400 hover:bg-orange-900/30 px-3 py-2 rounded-lg text-sm"><PauseCircle size={14} /> Put On Hold</button>
              </>
            )}
            {!isOpen && (
              <button onClick={() => setAction("reopen")} className="flex items-center gap-2 border border-amber-700 text-amber-400 hover:bg-amber-900/30 px-3 py-2 rounded-lg text-sm"><RefreshCcw size={14} /> Reopen</button>
            )}
            <button onClick={() => setAction("archive")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Archive size={14} /> Archive</button>
          </div>
        )}
        {deal.archived && (
          <button onClick={() => dispatch(restoreDeal(deal._id))} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 px-3 py-2 rounded-lg text-sm"><RotateCcw size={14} /> Restore</button>
        )}
      </div>

      {deal.status === "Won" && deal.winReason && (
        <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-4 mb-6 text-sm text-emerald-100">
          <strong>Won:</strong> {deal.winReason}{deal.handoffOwnerName && <> — handed off to {deal.handoffOwnerName}</>}
        </div>
      )}
      {deal.status === "Lost" && deal.lossReason && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4 mb-6 text-sm text-red-100">
          <strong>Lost:</strong> {deal.lossReason}{deal.lossCompetitor && <> to {deal.lossCompetitor}</>}
        </div>
      )}
      {deal.status === "Cancelled" && deal.cancellationReason && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-4 mb-6 text-sm text-gray-300">
          <strong>Cancelled:</strong> {deal.cancellationReason}
        </div>
      )}
      {deal.status === "On Hold" && deal.onHoldReason && (
        <div className="bg-orange-900/20 border border-orange-700/40 rounded-xl p-4 mb-6 text-sm text-orange-100">
          <strong>On Hold:</strong> {deal.onHoldReason}{deal.onHoldReviewDate && <> — review by {formatDate(deal.onHoldReviewDate)}</>}
        </div>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 mb-6">
        <StageProgress deal={deal} onChanged={() => dispatch(fetchDeal(id))} />
      </div>

      <div className="flex gap-1 border-b border-gray-800 mb-4 overflow-x-auto">
        {TABS.filter((t) => t !== "audit" || isSuperAdmin).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm whitespace-nowrap ${tab === t ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {t === "audit" ? <span className="flex items-center gap-1"><Shield size={14} /> Audit</span> : TAB_LABELS[t]}
            {t === "tasks" && overdueTasks.length > 0 && <span className="ml-1 text-red-400">({overdueTasks.length})</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab deal={deal} company={company} primaryContact={primaryContact} contacts={contacts} />}
      {tab === "activities" && (
        <ActivitiesTab
          activities={dealActivities}
          onOpen={(a) => setDrawerActivity(a)}
          onLog={() => setAction("logActivity")}
        />
      )}
      {tab === "contacts" && <ContactsTab deal={deal} company={company} contacts={contacts} />}
      {tab === "products" && <ProductsTab deal={deal} />}
      {tab === "quotes" && <QuotesTab deal={deal} />}
      {tab === "stagehistory" && <StageHistoryTab deal={deal} />}
      {tab === "tasks" && <TasksTab activities={dealActivities} onOpen={(a) => setDrawerActivity(a)} />}
      {tab === "files" && <FilesTab deal={deal} />}
      {tab === "audit" && isSuperAdmin && <AuditTab deal={deal} />}

      {showEdit && <DealFormModal deal={deal} onClose={() => setShowEdit(false)} onSaved={() => dispatch(fetchDeal(id))} />}
      {(action === "logActivity" || action === "followUp") && (
        <ActivityFormModal
          prefill={{ relatedRecordType: "Deal", relatedRecordId: deal._id, ownerId: deal.ownerId }}
          onClose={() => setAction(null)}
          onSaved={() => { setAction(null); dispatch(fetchActivities()); }}
        />
      )}
      {action === "won" && <MarkWonModal deal={deal} primaryContact={primaryContact} onClose={() => setAction(null)} onDone={() => dispatch(fetchDeal(id))} />}
      {action === "lost" && <MarkLostModal deal={deal} onClose={() => setAction(null)} onDone={() => dispatch(fetchDeal(id))} />}
      {action === "cancel" && <CancelDealModal deal={deal} onClose={() => setAction(null)} onDone={() => dispatch(fetchDeal(id))} />}
      {action === "hold" && <PutOnHoldModal deal={deal} onClose={() => setAction(null)} onDone={() => dispatch(fetchDeal(id))} />}
      {action === "reopen" && <ReopenDealModal deal={deal} onClose={() => setAction(null)} onDone={() => dispatch(fetchDeal(id))} />}
      {action === "archive" && <ArchiveDealModal deal={deal} onClose={() => setAction(null)} onDone={() => navigate("/crm/deals")} />}
      {editActivity && (
        <ActivityFormModal activity={editActivity} onClose={() => setEditActivity(null)} onSaved={() => dispatch(fetchActivities())} />
      )}
      {drawerActivity && (
        <ActivityDetailDrawer
          activity={allActivities.find((a) => a._id === drawerActivity._id) || drawerActivity}
          onClose={() => setDrawerActivity(null)}
          onEdit={() => { setEditActivity(drawerActivity); setDrawerActivity(null); }}
          onOpenActivity={(a) => setDrawerActivity(a)}
        />
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
      <h2 className="font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 min-w-0">
      <dt className="text-gray-400 shrink-0">{label}</dt>
      <dd className="truncate text-right" title={typeof value === "string" ? value : undefined}>{value ?? "—"}</dd>
    </div>
  );
}

function OverviewTab({ deal, company, primaryContact, contacts }) {
  const additionalContacts = (deal.additionalContactIds || []).map((cid) => contacts.find((c) => c._id === cid)).filter(Boolean);
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Section title="Deal Summary">
        <dl className="space-y-2 text-sm">
          <Row label="Company" value={company ? <Link to={`/crm/companies/${company._id}`} className="text-blue-400 hover:underline">{company.name}</Link> : "—"} />
          <Row label="Primary Contact" value={primaryContact ? <Link to={`/crm/contacts/${primaryContact._id}`} className="text-blue-400 hover:underline">{primaryContact.name}</Link> : "—"} />
          <Row label="Pipeline" value={deal.pipeline} />
          <Row label="Deal Type" value={deal.dealType} />
          <Row label="Source" value={deal.source} />
          <Row label="Priority" value={<DealPriorityBadge priority={deal.priority} />} />
          <Row label="Value" value={formatMoney(deal.value, deal.currency)} />
          <Row label="Probability" value={`${deal.probability}%`} />
          <Row label="Weighted Value" value={formatMoney(deal.weightedValue, deal.currency)} />
          <Row label="Expected Close" value={formatDate(deal.expectedClosingDate)} />
          {deal.actualClosingDate && <Row label="Actual Close" value={formatDate(deal.actualClosingDate)} />}
        </dl>
        {deal.description && <p className="text-sm text-gray-300 mt-3 pt-3 border-t border-gray-800">{deal.description}</p>}
        {deal.competitors?.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-gray-800">
            <span className="text-xs text-gray-500">Competitors:</span>
            {deal.competitors.map((c) => <span key={c} className="px-2 py-1 rounded-full text-xs bg-gray-800 text-gray-300">{c}</span>)}
          </div>
        )}
        {deal.tags?.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-gray-800">
            {deal.tags.map((t) => <span key={t} className="px-2 py-1 rounded-full text-xs bg-blue-900/30 text-blue-300">{t}</span>)}
          </div>
        )}
      </Section>

      <div className="space-y-6">
        <Section title="Stakeholders">
          <dl className="space-y-2 text-sm">
            <Row label="Owner" value={deal.ownerName || "Unassigned"} />
            <Row label="Team" value={deal.assignedTeam || "—"} />
          </dl>
          {additionalContacts.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-800">
              <p className="text-xs text-gray-500 mb-1">Additional Contacts</p>
              <ul className="text-sm space-y-1">
                {additionalContacts.map((c) => <li key={c._id}><Link to={`/crm/contacts/${c._id}`} className="text-blue-400 hover:underline">{c.name}</Link></li>)}
              </ul>
            </div>
          )}
        </Section>
        <Section title="Next Action">
          <p className="text-sm">{deal.nextAction || <span className="text-gray-500">No next action set.</span>}</p>
        </Section>
        <Section title="Record Information">
          <dl className="space-y-2 text-sm">
            <Row label="Created" value={`${formatDateTime(deal.createdAt)} by ${deal.createdBy}`} />
            <Row label="Updated" value={`${formatDateTime(deal.updatedAt)} by ${deal.updatedBy}`} />
          </dl>
        </Section>
      </div>
    </div>
  );
}

function ActivitiesTab({ activities, onOpen, onLog }) {
  const sorted = [...activities].sort((a, b) => new Date(b.startAt || b.createdAt) - new Date(a.startAt || a.createdAt));
  return (
    <Section title="Activities">
      <div className="flex justify-end mb-3">
        <button onClick={onLog} className="text-sm text-blue-400 hover:underline">+ Log Activity</button>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-500">No calls, emails, meetings, follow-ups, notes or stage changes logged for this deal yet.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((a) => (
            <li key={a._id}>
              <button onClick={() => onOpen(a)} className="w-full flex items-center justify-between gap-3 bg-gray-800/40 hover:bg-gray-800/70 rounded-lg p-3 text-left">
                <div className="flex items-center gap-2 min-w-0">
                  <TypeIcon type={a.type} size={14} />
                  <span className="text-sm truncate">{a.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge activity={a} status={a.status} />
                  <span className="text-xs text-gray-500">{formatDate(a.startAt || a.createdAt)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ContactsTab({ deal, company, contacts }) {
  const dispatch = useDispatch();
  const [showAdd, setShowAdd] = useState(false);
  const [newContactId, setNewContactId] = useState("");
  const roster = [deal.primaryContactId, ...(deal.additionalContactIds || [])].filter(Boolean).map((cid) => contacts.find((c) => c._id === cid)).filter(Boolean);
  const companyContacts = company ? contacts.filter((c) => c.companyId === company._id) : [];
  const availableToAdd = companyContacts.filter((c) => !roster.some((r) => r._id === c._id));
  const roleFor = (contactId) => deal.contactRoles?.find((r) => r.contactId === contactId) || {};

  const addContact = async (e) => {
    e.preventDefault();
    if (!newContactId) return;
    await dispatch(addDealContact({ id: deal._id, contactId: newContactId }));
    setShowAdd(false);
    setNewContactId("");
  };

  return (
    <Section title="Contacts">
      <div className="flex justify-end mb-3">
        <button onClick={() => setShowAdd(true)} disabled={availableToAdd.length === 0} className="text-sm text-blue-400 hover:underline disabled:opacity-40 disabled:no-underline">+ Add Existing Company Contact</button>
      </div>
      {roster.length === 0 ? (
        <p className="text-sm text-gray-500">No contacts linked to this deal yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left"><tr>
              <th className="py-2 pr-3 font-medium">Contact</th><th className="py-2 pr-3 font-medium">Job Title</th>
              <th className="py-2 pr-3 font-medium">Decision Role</th><th className="py-2 pr-3 font-medium">Influence</th>
              <th className="py-2 pr-3 font-medium">Relationship</th><th className="py-2 pr-3 font-medium">Primary</th>
              <th className="py-2 pr-3 font-medium text-right">Actions</th>
            </tr></thead>
            <tbody>
              {roster.map((c) => {
                const role = roleFor(c._id);
                const isPrimary = deal.primaryContactId === c._id;
                return (
                  <tr key={c._id} className="border-t border-gray-800">
                    <td className="py-2 pr-3"><Link to={`/crm/contacts/${c._id}`} className="text-blue-400 hover:underline">{c.name}</Link></td>
                    <td className="py-2 pr-3 text-gray-300">{c.jobTitle}</td>
                    <td className="py-2 pr-3">
                      <select value={role.role || ""} onChange={(e) => dispatch(updateDealContactRole({ id: deal._id, contactId: c._id, changes: { role: e.target.value } }))} className="bg-gray-800/60 border border-gray-700 rounded px-2 py-1 text-xs">
                        <option value="">—</option>
                        {DEAL_CONTACT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select value={role.influenceLevel || ""} onChange={(e) => dispatch(updateDealContactRole({ id: deal._id, contactId: c._id, changes: { influenceLevel: e.target.value } }))} className="bg-gray-800/60 border border-gray-700 rounded px-2 py-1 text-xs">
                        <option value="">—</option>
                        {DEAL_CONTACT_INFLUENCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select value={role.relationship || ""} onChange={(e) => dispatch(updateDealContactRole({ id: deal._id, contactId: c._id, changes: { relationship: e.target.value } }))} className="bg-gray-800/60 border border-gray-700 rounded px-2 py-1 text-xs">
                        <option value="">—</option>
                        {DEAL_CONTACT_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      {isPrimary ? <span className="flex items-center gap-1 text-amber-300 text-xs"><Star size={12} /> Primary</span> : (
                        <button onClick={() => dispatch(setDealPrimaryContact({ id: deal._id, contactId: c._id }))} className="text-xs text-blue-400 hover:underline">Make Primary</button>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {!isPrimary && (
                        <button onClick={() => { if (window.confirm(`Remove ${c.name} from this deal?`)) dispatch(removeDealContact({ id: deal._id, contactId: c._id })); }} aria-label={`Remove ${c.name}`} className="text-gray-500 hover:text-red-400">
                          <UserMinus size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddContactModal companyContacts={availableToAdd} newContactId={newContactId} setNewContactId={setNewContactId} onSubmit={addContact} onClose={() => setShowAdd(false)} />
      )}
    </Section>
  );
}

function AddContactModal({ companyContacts, newContactId, setNewContactId, onSubmit, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Add Contact" onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold">Add Existing Company Contact</h3>
        <select autoFocus value={newContactId} onChange={(e) => setNewContactId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <option value="">Select a contact...</option>
          {companyContacts.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Add</button>
        </div>
      </form>
    </div>
  );
}

function ProductsTab({ deal }) {
  const dispatch = useDispatch();
  const [lineItems, setLineItems] = useState(() => deal.lineItems.map((li) => ({ ...li })));
  const dirty = JSON.stringify(lineItems) !== JSON.stringify(deal.lineItems);
  const totals = computeLineItemTotals(lineItems);

  const addLine = () => setLineItems((li) => [...li, { _id: `new-${Date.now()}`, name: "", quantity: 1, unitPrice: 0, discountPercent: 0, billingFrequency: "One-time" }]);
  const updateLine = (idx, changes) => setLineItems((li) => li.map((item, i) => (i === idx ? { ...item, ...changes } : item)));
  const removeLine = (idx) => setLineItems((li) => li.filter((_, i) => i !== idx));
  const save = () => dispatch(setDealLineItems({ id: deal._id, lineItems }));

  return (
    <Section title="Products and Services">
      {lineItems.length === 0 && !dirty ? (
        <p className="text-sm text-gray-500 mb-3">No products or services added yet.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {lineItems.map((li, idx) => (
            <div key={li._id} className="grid grid-cols-12 gap-2 items-center bg-gray-800/30 rounded-lg p-2">
              <input value={li.name} onChange={(e) => updateLine(idx, { name: e.target.value })} placeholder="Name" className="col-span-4 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm" />
              <input type="number" min="1" value={li.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} className="col-span-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-center" />
              <input type="number" min="0" value={li.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} className="col-span-2 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm" />
              <input type="number" min="0" max="100" value={li.discountPercent} onChange={(e) => updateLine(idx, { discountPercent: e.target.value })} className="col-span-2 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm" />
              <select value={li.billingFrequency} onChange={(e) => updateLine(idx, { billingFrequency: e.target.value })} className="col-span-2 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm">
                {DEAL_BILLING_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button onClick={() => removeLine(idx)} aria-label={`Remove ${li.name || "line item"}`} className="col-span-1 text-red-400 hover:text-red-300 flex justify-center"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <button onClick={addLine} className="flex items-center gap-1.5 text-sm text-blue-400 hover:underline"><Plus size={14} /> Add Line</button>
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">Subtotal: {formatMoney(totals.subtotal, deal.currency)}</span>
          <span className="text-gray-400">Discount: {formatMoney(totals.discountTotal, deal.currency)}</span>
          <span className="font-semibold">Total: {formatMoney(totals.estimatedTotal, deal.currency)}</span>
          {totals.recurringValue > 0 && <span className="text-blue-300">Recurring: {formatMoney(totals.recurringValue, deal.currency)}</span>}
        </div>
      </div>
      {dirty && (
        <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-800">
          <button onClick={() => setLineItems(deal.lineItems.map((li) => ({ ...li })))} className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm">Discard</button>
          <button onClick={save} className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save Products</button>
        </div>
      )}
    </Section>
  );
}

function QuotesTab({ deal }) {
  const navigate = useNavigate();
  const related = quotes.filter((q) => q.dealId === deal._id);

  return (
    <Section title="Quotes">
      <p className="text-xs text-gray-500 mb-3">Uses the same shared Quote frontend state as the Sales Quotes routes.</p>
      {related.length === 0 ? (
        <p className="text-sm text-gray-500 mb-3">No Quotes linked to this Deal yet.</p>
      ) : (
        <table className="w-full text-sm mb-3">
          <thead className="text-gray-400 text-left"><tr>
            <th className="py-2 pr-3 font-medium">Quote #</th><th className="py-2 pr-3 font-medium">Version</th>
            <th className="py-2 pr-3 font-medium">Total</th><th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Created</th><th className="py-2 pr-3 font-medium">Valid Until</th>
          </tr></thead>
          <tbody>
            {related.map((q) => (
              <tr key={q._id} className="border-t border-gray-800">
                <td className="py-2 pr-3"><Link to={`/sales/quotes/${q._id}`} className="text-blue-400 hover:underline">{q.quoteNumber}</Link></td>
                <td className="py-2 pr-3 text-gray-300">v{q.version}</td>
                <td className="py-2 pr-3 text-gray-300">{formatMoney(computeQuoteTotals(q).grandTotal, q.currency)}</td>
                <td className="py-2 pr-3"><span className="px-2 py-1 rounded-full text-xs border border-gray-700 text-gray-300">{getQuoteEffectiveStatus(q)}</span></td>
                <td className="py-2 pr-3 text-gray-300">{formatDate(q.createdAt)}</td>
                <td className="py-2 pr-3 text-gray-300">{q.validUntilDate ? formatDate(q.validUntilDate) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={() => navigate(`/sales/quotes?newForDeal=${deal._id}`)} className="text-sm text-blue-400 hover:underline">
        + Create Quote for this Deal
      </button>
    </Section>
  );
}

function StageHistoryTab({ deal }) {
  const history = [...deal.stageHistory].reverse();
  return (
    <Section title="Stage History">
      {history.length === 0 ? (
        <p className="text-sm text-gray-500">No stage changes yet.</p>
      ) : (
        <ul className="space-y-3">
          {history.map((h) => (
            <li key={h._id} className="text-sm border-b border-gray-800 pb-3 last:border-0">
              <p>{h.from ? <>{h.from} → <strong>{h.to}</strong></> : <>Created in <strong>{h.to}</strong></>}</p>
              <p className="text-xs text-gray-500">
                {formatDateTime(h.at)} by {h.changedBy}
                {h.timeInStagePriorMs != null && <> · spent {formatDuration(h.timeInStagePriorMs)} in the previous stage</>}
              </p>
              {h.note && <p className="text-xs text-gray-400 mt-1">{h.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TasksTab({ activities, onOpen }) {
  const dispatch = useDispatch();
  const tasks = activities.filter((a) => a.type === "Task");
  const now = new Date();
  const open = tasks.filter((t) => !["Completed", "Cancelled"].includes(t.status) && (!t.dueDate || new Date(t.dueDate) >= now));
  const overdue = tasks.filter((t) => !["Completed", "Cancelled"].includes(t.status) && t.dueDate && new Date(t.dueDate) < now);
  const completed = tasks.filter((t) => t.status === "Completed");

  const complete = (task) => dispatch(completeActivity({ id: task._id, outcome: null }));

  const group = (title, list, allowComplete) => (
    <div className="mb-4 last:mb-0">
      <p className="text-xs font-semibold uppercase text-gray-500 mb-2">{title} ({list.length})</p>
      {list.length === 0 ? <p className="text-sm text-gray-600">None.</p> : (
        <ul className="space-y-2">
          {list.map((t) => (
            <li key={t._id} className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3 text-sm">
              <button onClick={() => onOpen(t)} className="flex items-center gap-2 text-left min-w-0">
                {allowComplete ? (
                  <span onClick={(e) => { e.stopPropagation(); complete(t); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); complete(t); } }} aria-label={`Mark ${t.title} complete`}>
                    <Circle size={16} className="text-gray-500 hover:text-emerald-400" />
                  </span>
                ) : <CheckCircle2 size={16} className="text-emerald-400" />}
                <span className={`truncate ${t.status === "Completed" ? "line-through text-gray-500" : ""}`}>{t.title}</span>
              </button>
              <span className="text-xs text-gray-400 shrink-0">{t.ownerName || "Unassigned"} · {t.priority} · Due {formatDate(t.dueDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Section title="Tasks">
      {group("Overdue", overdue, true)}
      {group("Open", open, true)}
      {group("Completed", completed, false)}
    </Section>
  );
}

function FilesTab({ deal }) {
  const dispatch = useDispatch();

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    dispatch(uploadDealFile({ id: deal._id, file: { name: file.name, size: file.size, type: file.type, dataUrl } }));
    e.target.value = "";
  };

  return (
    <Section title="Files">
      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-700 rounded-xl p-6 text-sm text-gray-400 cursor-pointer hover:border-gray-600 mb-4">
        <Upload size={20} />
        Click to upload a file
        <input type="file" onChange={handleUpload} className="hidden" />
      </label>
      {deal.files.length === 0 ? (
        <p className="text-sm text-gray-500">No files uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {deal.files.map((file) => (
            <li key={file._id} className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={16} className="text-gray-400 shrink-0" />
                <div className="min-w-0">
                  {file.dataUrl ? <a href={file.dataUrl} download={file.name} className="text-blue-300 hover:underline truncate block">{file.name}</a> : <span className="truncate block">{file.name}</span>}
                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB · {file.type || "unknown type"} · uploaded by {file.uploadedBy} on {formatDate(file.uploadedAt)}</p>
                </div>
              </div>
              <button onClick={() => dispatch(deleteDealFile({ id: deal._id, fileId: file._id }))} className="text-gray-500 hover:text-red-400 text-xs shrink-0">Remove</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AuditTab({ deal }) {
  const log = [...deal.auditLog].reverse();
  return (
    <Section title="Audit History">
      {log.length === 0 ? (
        <p className="text-sm text-gray-500">No audit events yet.</p>
      ) : (
        <ul className="space-y-3">
          {log.map((e) => (
            <li key={e._id} className="text-sm border-b border-gray-800 pb-3 last:border-0">
              <p><span className="font-medium capitalize">{e.action.replace(/_/g, " ")}</span> by {e.actor}{e.field && <> — {e.field}: {String(e.before)} → {String(e.after)}</>}</p>
              {e.reason && <p className="text-xs text-amber-300">Reason: {e.reason}</p>}
              <p className="text-xs text-gray-500">{formatDateTime(e.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
