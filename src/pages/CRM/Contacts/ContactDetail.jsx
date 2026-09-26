import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Pencil, UserCog, StickyNote, PhoneCall, CalendarClock, Archive, RotateCcw,
  Paperclip, MoreHorizontal, Mail, Phone, Building2, ShieldAlert, CheckCircle2,
  TrendingUp, Wallet, ListChecks, Shield, AlertTriangle, Upload,
} from "lucide-react";
import {
  fetchContact, assignContact, changeLifecycle, setDoNotContact,
  addContactNote, logContactActivity, createContactTask, updateContactTask,
  uploadContactFile, deleteContactFile, archiveContact, restoreContact,
} from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchTickets } from "../../../redux/support/ticketsSlice";
import { fetchProjects } from "../../../redux/projects/projectsSlice";
import { fetchQuotes } from "../../../redux/sales/quotesSlice";
import { fetchOrders } from "../../../redux/sales/ordersSlice";
import { fetchInvoices } from "../../../redux/finance/invoicesSlice";
import { contactCommunicationStatus, CONTACT_LIFECYCLE_STAGES } from "../../../Helpers/mockCrmData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import ContactFormModal from "./ContactFormModal";

const TABS = ["overview", "activity", "deals", "support", "projects", "finance", "tasks", "files", "audit"];
const TAB_LABELS = {
  overview: "Overview", activity: "Activity", deals: "Deals", support: "Support",
  projects: "Projects", finance: "Finance", tasks: "Tasks", files: "Files", audit: "Audit",
};
const ACTIVITY_ICONS = {
  created: StickyNote, note: StickyNote, call: PhoneCall, email: Mail, meeting: CalendarClock,
  task: ListChecks, owner_changed: UserCog, lifecycle_changed: TrendingUp, file_uploaded: Paperclip,
  archived: Archive, restored: RotateCcw,
};
const RELATIONSHIP_COLORS = {
  Customer: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Prospect: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Former Customer": "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Partner: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Vendor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};
const COMM_STATUS_COLORS = {
  Active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Restricted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Do Not Contact": "bg-red-500/15 text-red-300 border-red-500/30",
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

export default function ContactDetail() {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const { id } = useParams();
  const dispatch = useDispatch();
  const contact = useSelector((s) => s.contacts.current);
  const notFound = useSelector((s) => s.contacts.currentNotFound);

  const [tab, setTab] = useState("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [modal, setModal] = useState(null); // "note" | "activity" | "task" | "owner" | "lifecycle" | "dnc" | "archive"

  useEffect(() => {
    dispatch(fetchContact(id));
    dispatch(fetchDeals());
    dispatch(fetchTickets());
    dispatch(fetchProjects());
    dispatch(fetchQuotes());
    dispatch(fetchOrders());
    dispatch(fetchInvoices());
  }, [dispatch, id]);

  const allDeals = useSelector((s) => s.deals.items);
  const allTickets = useSelector((s) => s.tickets.items);
  const allProjects = useSelector((s) => s.projects.items);
  const allQuotes = useSelector((s) => s.quotes.items);
  const allOrders = useSelector((s) => s.orders.items);
  const allInvoices = useSelector((s) => s.invoices.items);

  const deals = useMemo(() => allDeals.filter((d) => d.primaryContactId === id || (d.additionalContactIds || []).includes(id)), [allDeals, id]);
  const tickets = useMemo(() => allTickets.filter((t) => t.contactId === id), [allTickets, id]);
  const projects = useMemo(() => (contact?.companyId ? allProjects.filter((p) => p.companyId === contact.companyId) : []), [allProjects, contact]);
  const quotes = useMemo(() => allQuotes.filter((q) => q.contactId === id || (contact?.companyId && q.companyId === contact.companyId)), [allQuotes, id, contact]);
  const orders = useMemo(() => (contact?.companyId ? allOrders.filter((o) => o.companyId === contact.companyId) : []), [allOrders, contact]);
  const invoices = useMemo(() => (contact?.companyId ? allInvoices.filter((inv) => inv.companyId === contact.companyId) : []), [allInvoices, contact]);

  if (notFound) {
    return (
      <div className="p-6 text-white max-w-lg">
        <p className="text-lg font-semibold mb-1">Contact not found</p>
        <p className="text-sm text-gray-400 mb-4">
          This contact doesn't exist or is no longer available. This preview environment persists data in memory
          only, so a full page reload clears anything created during the session.
        </p>
        <Link to="/crm/contacts" className="text-blue-400 hover:underline text-sm">Back to Contacts</Link>
      </div>
    );
  }
  if (!contact) return <ContactDetailSkeleton />;

  const commStatus = contactCommunicationStatus(contact);
  const sortedActivity = [...(contact.activity || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  const lastActivity = sortedActivity[0]?.at || null;
  const upcomingTasks = (contact.tasks || []).filter((t) => !t.completed && t.dueDate);
  const nextActivity = upcomingTasks.length
    ? upcomingTasks.reduce((min, t) => (new Date(t.dueDate) < new Date(min) ? t.dueDate : min), upcomingTasks[0].dueDate)
    : contact.nextFollowUp;

  const closeModal = () => setModal(null);
  const afterAction = () => closeModal();

  return (
    <div className="p-6 text-white max-w-6xl">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> /{" "}
        <Link to="/crm/contacts" className="hover:text-gray-300">Contacts</Link> / <span className="text-gray-300">{contact.name}</span>
      </nav>
      <Link to="/crm/contacts" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 w-fit">
        <ArrowLeft size={16} /> Back to Contacts
      </Link>

      {contact.archived && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-3 mb-4 text-sm text-gray-300 flex items-center justify-between">
          <span><strong>Archived:</strong> {contact.archiveReason}</span>
          <button onClick={() => dispatch(restoreContact(contact._id))} className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 text-sm font-medium">
            <RotateCcw size={14} /> Restore
          </button>
        </div>
      )}
      {contact.doNotContact && (
        <div className="bg-red-900/15 border border-red-800/40 rounded-xl p-3 mb-4 text-sm text-red-200 flex items-start gap-2">
          <ShieldAlert size={16} className="shrink-0 mt-0.5" />
          <span><strong>Do Not Contact.</strong> {contact.doNotContactReason || "Outbound email, phone, SMS and marketing actions are restricted for this contact."}</span>
        </div>
      )}

      {/* Record header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-900/40 border border-blue-700/40 flex items-center justify-center text-lg font-semibold text-blue-200 shrink-0">
            {initials(contact.name)}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{contact.name}</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {contact.jobTitle}{contact.jobTitle && contact.companyId ? " · " : ""}
              {contact.companyId ? (
                <Link to={`/crm/companies/${contact.companyId}`} className="text-blue-400 hover:underline inline-flex items-center gap-1"><Building2 size={12} />{contact.companyName}</Link>
              ) : (
                <span className="text-gray-500">No company</span>
              )}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2" data-tour="contact-badges">
              <span className={`px-2 py-1 rounded-full text-xs border ${RELATIONSHIP_COLORS[contact.relationshipType] || RELATIONSHIP_COLORS.Prospect}`}>{contact.relationshipType}</span>
              <span className="px-2 py-1 rounded-full text-xs border border-gray-700 text-gray-300 bg-gray-800/50">{contact.lifecycleStage}</span>
              <span className={`px-2 py-1 rounded-full text-xs border ${COMM_STATUS_COLORS[commStatus]}`}>{commStatus}</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Owner: {contact.ownerName || "Unassigned"} · Last activity: {lastActivity ? new Date(lastActivity).toLocaleDateString() : "—"} · Next: {nextActivity ? new Date(nextActivity).toLocaleDateString() : "—"}
            </p>
          </div>
        </div>

        {!contact.archived && (
          <div className="flex gap-2 flex-wrap items-start" data-tour="contact-actions">
            <button onClick={() => setShowEdit(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Pencil size={14} /> Edit</button>
            <button onClick={() => setModal("note")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><StickyNote size={14} /> Add Note</button>
            <button onClick={() => setModal("activity")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><PhoneCall size={14} /> Log Activity</button>
            <button onClick={() => setModal("task")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><ListChecks size={14} /> Create Task</button>
            <button
              onClick={() => (contact.doNotContact ? setModal("dnc-warning") : setModal("meeting"))}
              className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"
              title={contact.doNotContact ? "This contact is marked Do Not Contact" : undefined}
            >
              <CalendarClock size={14} /> Schedule Meeting
            </button>
            <div className="relative">
              <button data-tour="contact-more" onClick={() => setShowMore((v) => !v)} aria-haspopup="menu" aria-expanded={showMore} className="p-2 border border-gray-700 hover:bg-gray-800 rounded-lg"><MoreHorizontal size={16} /></button>
              {showMore && (
                <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-48 shadow-xl">
                  <button role="menuitem" onClick={() => { setModal("owner"); setShowMore(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Change Owner</button>
                  <button role="menuitem" onClick={() => { setModal("lifecycle"); setShowMore(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Change Lifecycle</button>
                  <button role="menuitem" onClick={() => { setModal("dnc"); setShowMore(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">
                    {contact.doNotContact ? "Remove Do Not Contact" : "Mark Do Not Contact"}
                  </button>
                  <button role="menuitem" onClick={() => { setModal("archive"); setShowMore(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 text-red-400">Archive</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800 mb-4 overflow-x-auto" data-tour="contact-tabs">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm whitespace-nowrap ${tab === t ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {t === "audit" ? <span className="flex items-center gap-1"><Shield size={14} /> Audit</span> : TAB_LABELS[t]}
            {t === "tasks" && upcomingTasks.some((tk) => new Date(tk.dueDate) < new Date()) && <span className="ml-1 text-red-400">•</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab contact={contact} />}
      {tab === "activity" && <ActivityTab activity={sortedActivity} />}
      {tab === "deals" && <DealsTab deals={deals} />}
      {tab === "support" && <SupportTab tickets={tickets} />}
      {tab === "projects" && <ProjectsTab projects={projects} />}
      {tab === "finance" && <FinanceTab quotes={quotes} orders={orders} invoices={invoices} />}
      {tab === "tasks" && <TasksTab contact={contact} onToggle={(taskId, completed) => dispatch(updateContactTask({ id: contact._id, taskId, changes: { completed: !completed } }))} onAdd={() => setModal("task")} />}
      {tab === "files" && (
        <FilesTab
          contact={contact}
          onUpload={async (file) => {
            const dataUrl = await fileToDataUrl(file);
            dispatch(uploadContactFile({ id: contact._id, file: { name: file.name, size: file.size, type: file.type, dataUrl } }));
          }}
          onDelete={(fileId) => dispatch(deleteContactFile({ id: contact._id, fileId }))}
        />
      )}
      {tab === "audit" && <AuditTab auditLog={contact.auditLog || []} />}

      {showEdit && <ContactFormModal contact={contact} onClose={() => setShowEdit(false)} />}

      {modal === "note" && (
        <SimpleFormModal title="Add Note" onClose={closeModal} onSubmit={(text) => { dispatch(addContactNote({ id: contact._id, message: text })); afterAction(); }}>
          {(value, setValue) => <textarea autoFocus required value={value} onChange={(e) => setValue(e.target.value)} rows={3} placeholder="Add a note about this contact..." className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />}
        </SimpleFormModal>
      )}

      {modal === "activity" && (
        <LogActivityModal contact={contact} onClose={closeModal} onSubmit={(type, description) => { dispatch(logContactActivity({ id: contact._id, type, description })); afterAction(); }} />
      )}

      {modal === "meeting" && (
        <LogActivityModal contact={contact} forcedType="meeting" title="Schedule Meeting" onClose={closeModal} onSubmit={(type, description) => { dispatch(logContactActivity({ id: contact._id, type: "meeting", description })); afterAction(); }} />
      )}

      {modal === "dnc-warning" && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-red-800/50 rounded-2xl w-full max-w-sm p-6 space-y-3">
            <div className="flex items-center gap-2 text-red-300"><AlertTriangle size={18} /><h3 className="font-bold">Action restricted</h3></div>
            <p className="text-sm text-gray-300">
              {contact.name} is marked <strong>Do Not Contact</strong>{contact.doNotContactReason ? ` (${contact.doNotContactReason})` : ""}.
              Scheduling a meeting or other outbound communication is disabled. Internal actions like notes and tasks remain available.
            </p>
            <div className="flex justify-end"><button onClick={closeModal} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Close</button></div>
          </div>
        </div>
      )}

      {modal === "task" && (
        <TaskFormModal contact={contact} onClose={closeModal} onSubmit={(task) => { dispatch(createContactTask({ id: contact._id, task })); afterAction(); }} />
      )}

      {modal === "owner" && (
        <SelectFormModal title="Change Owner" options={crmTeam.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))} initial={contact.ownerId} onClose={closeModal}
          onSubmit={(ownerId) => { dispatch(assignContact({ id: contact._id, ownerId })); afterAction(); }} />
      )}

      {modal === "lifecycle" && (
        <SelectFormModal title="Change Lifecycle" options={CONTACT_LIFECYCLE_STAGES.map((l) => ({ value: l, label: l }))} initial={contact.lifecycleStage} onClose={closeModal}
          onSubmit={(lifecycleStage) => { dispatch(changeLifecycle({ id: contact._id, lifecycleStage })); afterAction(); }} />
      )}

      {modal === "dnc" && (
        <DoNotContactModal contact={contact} onClose={closeModal}
          onSubmit={(reason) => { dispatch(setDoNotContact({ id: contact._id, doNotContact: !contact.doNotContact, reason })); afterAction(); }} />
      )}

      {modal === "archive" && (
        <SimpleFormModal title="Archive Contact" submitLabel="Archive" danger onClose={closeModal} onSubmit={(reason) => { dispatch(archiveContact({ id: contact._id, reason })); afterAction(); }}>
          {(value, setValue) => (
            <>
              <p className="text-sm text-gray-400">Archiving <strong className="text-white">{contact.name}</strong> moves them into the Archived view for this session.</p>
              <textarea autoFocus required value={value} onChange={(e) => setValue(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </>
          )}
        </SimpleFormModal>
      )}
    </div>
  );
}

function ContactDetailSkeleton() {
  return (
    <div className="p-6 text-white max-w-6xl animate-pulse">
      <div className="h-3 w-40 bg-gray-800 rounded mb-4" />
      <div className="flex items-start gap-4 mb-6">
        <div className="w-14 h-14 rounded-full bg-gray-800" />
        <div className="space-y-2">
          <div className="h-5 w-48 bg-gray-800 rounded" />
          <div className="h-3 w-64 bg-gray-800 rounded" />
        </div>
      </div>
      <div className="h-8 bg-gray-800/60 rounded mb-4" />
      <div className="grid md:grid-cols-2 gap-6">
        <div className="h-40 bg-gray-900/40 border border-gray-800 rounded-xl" />
        <div className="h-40 bg-gray-900/40 border border-gray-800 rounded-xl" />
      </div>
    </div>
  );
}

function OverviewTab({ contact }) {
  const Row = ({ label, value }) => (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-800/60 last:border-0">
      <dt className="text-gray-400 shrink-0">{label}</dt>
      <dd className="text-right min-w-0 truncate" title={typeof value === "string" ? value : undefined}>{value ?? "—"}</dd>
    </div>
  );
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
        <h2 className="font-semibold mb-3">Contact Details</h2>
        <dl className="text-sm">
          <Row label="Email" value={<span className="flex items-center gap-1.5 justify-end min-w-0"><Mail size={13} className="text-gray-500 shrink-0" /><span className="truncate" title={contact.email}>{contact.email || "—"}</span></span>} />
          <Row label="Phone" value={<span className="flex items-center gap-1.5 justify-end min-w-0"><Phone size={13} className="text-gray-500 shrink-0" /><span className="truncate">{contact.phone || "—"}</span></span>} />
          <Row label="Country" value={contact.country} />
          <Row label="Time Zone" value={contact.timezone} />
          <Row label="Preferred Language" value={contact.preferredLanguage} />
          <Row label="Preferred Channel" value={contact.preferredChannel} />
        </dl>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
        <h2 className="font-semibold mb-3">Company &amp; Role</h2>
        <dl className="text-sm">
          <Row label="Company" value={contact.companyId ? <Link to={`/crm/companies/${contact.companyId}`} className="text-blue-400 hover:underline">{contact.companyName}</Link> : "No company"} />
          <Row label="Job Title" value={contact.jobTitle} />
          <Row label="Business Department" value={contact.businessDepartment} />
          <Row label="Decision-Making Role" value={contact.decisionMakingRole} />
        </dl>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
        <h2 className="font-semibold mb-3">CRM Ownership</h2>
        <dl className="text-sm">
          <Row label="Owner" value={contact.ownerName || "Unassigned"} />
          <Row label="Relationship Type" value={contact.relationshipType} />
          <Row label="Lifecycle Stage" value={contact.lifecycleStage} />
          <Row label="Source" value={contact.source} />
          <Row label="Next Follow-up" value={contact.nextFollowUp ? new Date(contact.nextFollowUp).toLocaleDateString() : "—"} />
        </dl>
        {contact.tags?.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-gray-800">
            {contact.tags.map((t) => <span key={t} className="px-2 py-1 rounded-full text-xs bg-gray-800 text-gray-300">{t}</span>)}
          </div>
        )}
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
        <h2 className="font-semibold mb-3">Communication Preferences</h2>
        <dl className="text-sm">
          <Row label="Email" value={<PrefBadge on={contact.emailAllowed} />} />
          <Row label="Phone" value={<PrefBadge on={contact.phoneAllowed} />} />
          <Row label="SMS" value={<PrefBadge on={contact.smsAllowed} />} />
          <Row label="Marketing" value={<PrefBadge on={contact.marketingAllowed} />} />
          <Row label="Do Not Contact" value={contact.doNotContact ? <span className="text-red-400 font-medium">Yes</span> : "No"} />
        </dl>
        <div className="pt-3 mt-3 border-t border-gray-800 text-xs text-gray-500">
          Created {new Date(contact.createdAt).toLocaleString()} by {contact.createdBy} · Updated {new Date(contact.updatedAt).toLocaleString()} by {contact.updatedBy}
        </div>
      </div>
    </div>
  );
}
function PrefBadge({ on }) {
  return on ? (
    <span className="text-emerald-400 flex items-center gap-1 justify-end"><CheckCircle2 size={13} /> Allowed</span>
  ) : (
    <span className="text-gray-500">Not allowed</span>
  );
}

function ActivityTab({ activity }) {
  const [filter, setFilter] = useState("all");
  const types = useMemo(() => ["all", ...new Set(activity.map((a) => a.type))], [activity]);
  const filtered = filter === "all" ? activity : activity.filter((a) => a.type === filter);
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-semibold">Activity Timeline</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter activity by type" className="bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-xs">
          {types.map((t) => <option key={t} value={t}>{t === "all" ? "All types" : t.replace("_", " ")}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500">No activity yet.</p>
      ) : (
        <ul className="space-y-4">
          {filtered.map((event) => {
            const Icon = ACTIVITY_ICONS[event.type] || StickyNote;
            return (
              <li key={event._id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center shrink-0"><Icon size={14} className="text-blue-400" /></div>
                <div>
                  <p className="text-sm">{event.description}</p>
                  <p className="text-xs text-gray-500">
                    {event.type.replace("_", " ")} · {event.actor} · {new Date(event.at).toLocaleString()}
                    {event.outcome && ` · Outcome: ${event.outcome}`}
                    {event.relatedRecord && ` · ${event.relatedRecord}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DealsTab({ deals }) {
  if (deals.length === 0) return <EmptyPanel icon={TrendingUp} text="No deals linked to this contact yet." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Deal</th><th className="px-4 py-3 font-medium">Stage</th>
          <th className="px-4 py-3 font-medium">Value</th><th className="px-4 py-3 font-medium">Owner</th>
          <th className="px-4 py-3 font-medium">Expected Close</th><th className="px-4 py-3 font-medium">Status</th>
        </tr></thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d._id} className="border-t border-gray-800">
              <td className="px-4 py-3 font-medium">
                <Link to={`/crm/deals/${d._id}`} className="text-blue-400 hover:underline">{d.name}</Link>
              </td>
              <td className="px-4 py-3 text-gray-300">{d.stage}</td>
              <td className="px-4 py-3 text-gray-300">{d.currency} {d.value?.toLocaleString()}</td>
              <td className="px-4 py-3 text-gray-300">{d.ownerName || "Unassigned"}</td>
              <td className="px-4 py-3 text-gray-300">{d.expectedClosingDate ? new Date(d.expectedClosingDate).toLocaleDateString() : "—"}</td>
              <td className="px-4 py-3"><span className="px-2 py-1 rounded-full text-xs border border-gray-700 text-gray-300">{d.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Preview only — stored in this session's in-memory frontend state.</p>
    </div>
  );
}

function SupportTab({ tickets }) {
  if (tickets.length === 0) return <EmptyPanel icon={ListChecks} text="No support tickets linked to this contact." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Ticket</th><th className="px-4 py-3 font-medium">Subject</th>
          <th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Priority</th>
          <th className="px-4 py-3 font-medium">Agent</th><th className="px-4 py-3 font-medium">Last Update</th>
        </tr></thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t._id} className="border-t border-gray-800">
              <td className="px-4 py-3 font-medium">{t.ticketNumber}</td>
              <td className="px-4 py-3 text-gray-300">{t.subject}</td>
              <td className="px-4 py-3 text-gray-300">{t.status}</td>
              <td className="px-4 py-3 text-gray-300">{t.priority}</td>
              <td className="px-4 py-3 text-gray-300">{t.assignedAgent || "Unassigned"}</td>
              <td className="px-4 py-3 text-gray-300">{new Date(t.resolution?.resolvedAt || t.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectsTab({ projects }) {
  if (projects.length === 0) return <EmptyPanel icon={ListChecks} text="No projects linked to this contact's company." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Project</th><th className="px-4 py-3 font-medium">Status</th>
          <th className="px-4 py-3 font-medium">Progress</th><th className="px-4 py-3 font-medium">Manager</th>
          <th className="px-4 py-3 font-medium">Next Milestone</th>
        </tr></thead>
        <tbody>
          {projects.map((p) => {
            const milestones = p.milestones || [];
            const done = milestones.filter((m) => m.completed).length;
            const progress = milestones.length ? Math.round((done / milestones.length) * 100) : 0;
            const next = milestones.find((m) => !m.completed);
            return (
              <tr key={p._id} className="border-t border-gray-800">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-gray-300">{p.status}</td>
                <td className="px-4 py-3 text-gray-300">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${progress}%` }} /></div>
                    <span className="text-xs">{progress}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-300">{p.owner}</td>
                <td className="px-4 py-3 text-gray-300">{next ? `${next.name} · ${new Date(next.dueDate).toLocaleDateString()}` : "Complete"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FinanceTab({ quotes, orders, invoices }) {
  if (quotes.length === 0 && orders.length === 0 && invoices.length === 0) {
    return <EmptyPanel icon={Wallet} text="No quotes, orders or invoices linked to this contact's company yet." />;
  }
  return (
    <div className="space-y-4">
      {quotes.length > 0 && (
        <FinanceSection title="Quotes" rows={quotes} cols={["quoteNumber", "status", "total"]} labels={["Quote", "Status", "Total"]} />
      )}
      {orders.length > 0 && (
        <FinanceSection title="Orders" rows={orders} cols={["orderNumber", "status", "total"]} labels={["Order", "Status", "Total"]} />
      )}
      {invoices.length > 0 && (
        <FinanceSection title="Invoices" rows={invoices} cols={["invoiceNumber", "status", "amountDue"]} labels={["Invoice", "Payment Status", "Amount Due"]} />
      )}
    </div>
  );
}
function FinanceSection({ title, rows, cols, labels }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <h3 className="px-4 py-3 font-semibold border-b border-gray-800">{title}</h3>
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>{labels.map((l) => <th key={l} className="px-4 py-3 font-medium">{l}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id} className="border-t border-gray-800">
              {cols.map((c) => (
                <td key={c} className="px-4 py-3 text-gray-300">{typeof r[c] === "number" ? `$${r[c].toLocaleString()}` : r[c]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TasksTab({ contact, onToggle, onAdd }) {
  const tasks = contact.tasks || [];
  const open = tasks.filter((t) => !t.completed && !(new Date(t.dueDate) < new Date()));
  const overdue = tasks.filter((t) => !t.completed && new Date(t.dueDate) < new Date());
  const completed = tasks.filter((t) => t.completed);
  const Section = ({ title, items, colorClass }) => items.length > 0 && (
    <div>
      <h3 className={`text-xs uppercase tracking-wide mb-2 ${colorClass || "text-gray-400"}`}>{title} ({items.length})</h3>
      <ul className="space-y-2">
        {items.map((task) => (
          <li key={task._id} className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3 text-sm">
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={task.completed} onChange={() => onToggle(task._id, task.completed)} aria-label={`Mark "${task.title}" ${task.completed ? "incomplete" : "complete"}`} />
              <span className={task.completed ? "line-through text-gray-500" : ""}>{task.title}</span>
            </label>
            <span className="text-xs text-gray-400">{task.assignee} · {task.priority} · Due {new Date(task.dueDate).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold">Tasks</h2>
        <button onClick={onAdd} className="text-sm text-blue-400 hover:underline">+ Add Task</button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-500">No tasks yet.</p>
      ) : (
        <>
          <Section title="Overdue" items={overdue} colorClass="text-red-400" />
          <Section title="Open" items={open} />
          <Section title="Completed" items={completed} colorClass="text-gray-500" />
        </>
      )}
    </div>
  );
}

function FilesTab({ contact, onUpload, onDelete }) {
  const files = contact.files || [];
  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) onUpload(file);
  };
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold">Files</h2>
        <label className="text-sm text-blue-400 hover:underline cursor-pointer">
          + Upload File
          <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
      </div>
      <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} className="border-2 border-dashed border-gray-700 rounded-xl p-6 mb-4 text-center text-sm text-gray-500 flex flex-col items-center gap-2">
        <Upload size={18} /> Drag and drop a file here, or use "Upload File" above.
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-gray-500">No files uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => (
            <li key={file._id} className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3 text-sm">
              <div>
                <a href={file.dataUrl} download={file.name} className="text-blue-300 hover:underline">{file.name}</a>
                <p className="text-xs text-gray-500">{file.type || "file"} · {(file.size / 1024).toFixed(1)} KB · uploaded by {file.uploadedBy} on {new Date(file.uploadedAt).toLocaleDateString()}</p>
              </div>
              <div className="relative">
                <FileActionsMenu onDelete={() => onDelete(file._id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function FileActionsMenu({ onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label="File actions" className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white"><MoreHorizontal size={14} /></button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-32 shadow-xl">
          <button role="menuitem" onClick={() => { onDelete(); setOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 text-red-400">Remove</button>
        </div>
      )}
    </div>
  );
}

function AuditTab({ auditLog }) {
  if (auditLog.length === 0) return <EmptyPanel icon={Shield} text="No audit events yet." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Actor</th><th className="px-4 py-3 font-medium">Action</th>
          <th className="px-4 py-3 font-medium">Field</th><th className="px-4 py-3 font-medium">Previous</th>
          <th className="px-4 py-3 font-medium">New</th><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Reason</th>
        </tr></thead>
        <tbody>
          {[...auditLog].reverse().map((e) => (
            <tr key={e._id} className="border-t border-gray-800">
              <td className="px-4 py-3 text-gray-300">{e.actor}</td>
              <td className="px-4 py-3 text-gray-300 capitalize">{e.action}</td>
              <td className="px-4 py-3 text-gray-300">{e.field || "—"}</td>
              <td className="px-4 py-3 text-gray-400">{String(e.before ?? "—")}</td>
              <td className="px-4 py-3 text-gray-300">{String(e.after ?? "—")}</td>
              <td className="px-4 py-3 text-gray-500">{new Date(e.at).toLocaleString()}</td>
              <td className="px-4 py-3 text-amber-300">{e.reason || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Visual preview only — backend audit integration will happen in a later phase.</p>
    </div>
  );
}

function EmptyPanel({ icon, text }) {
  const Icon = icon;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
      <Icon size={22} className="mx-auto mb-2 text-gray-600" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

function SimpleFormModal({ title, submitLabel = "Save", danger, onClose, onSubmit, children }) {
  const [value, setValue] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value);
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{title}</h2>
        {children(value, setValue)}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className={`px-4 py-2 rounded-lg text-sm font-medium ${danger ? "bg-red-700 hover:bg-red-800" : "bg-blue-700 hover:bg-blue-800"}`}>{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

function LogActivityModal({ contact, forcedType, title = "Log Activity", onClose, onSubmit }) {
  const [type, setType] = useState(forcedType || "call");
  const [description, setDescription] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const restricted = contact.doNotContact && ["call", "email", "meeting"].includes(type);
  const submit = (e) => {
    e.preventDefault();
    if (!description.trim() || restricted) return;
    onSubmit(type, description);
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{title}</h2>
        {!forcedType && (
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {["call", "email", "meeting", "note"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
        )}
        {restricted && (
          <p className="text-xs text-amber-300 flex items-center gap-1.5"><AlertTriangle size={13} /> This contact is marked Do Not Contact — outbound {type} is disabled.</p>
        )}
        <textarea autoFocus required value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What happened?" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={restricted} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-sm font-medium">Save</button>
        </div>
      </form>
    </div>
  );
}

function TaskFormModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("Medium");
  const containerRef = useFocusTrap(true, onClose);
  const submit = (e) => {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;
    onSubmit({ title, dueDate, priority });
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Create Task" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Create Task</h2>
        <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-3">
          <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create</button>
        </div>
      </form>
    </div>
  );
}

function SelectFormModal({ title, options, initial, onClose, onSubmit }) {
  const [value, setValue] = useState(initial || "");
  const containerRef = useFocusTrap(true, onClose);
  const submit = (e) => {
    e.preventDefault();
    if (!value) return;
    onSubmit(value);
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <select autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <option value="">Select...</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
        </div>
      </form>
    </div>
  );
}

function DoNotContactModal({ contact, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const marking = !contact.doNotContact;
  const submit = (e) => {
    e.preventDefault();
    if (marking && !reason.trim()) return;
    onSubmit(reason);
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label={marking ? "Mark Do Not Contact" : "Remove Do Not Contact"} onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{marking ? "Mark Do Not Contact" : "Remove Do Not Contact"}</h2>
        {marking ? (
          <>
            <p className="text-sm text-gray-400">This disables email, phone, SMS and marketing actions for {contact.name}.</p>
            <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </>
        ) : (
          <p className="text-sm text-gray-400">Communication channels will need to be re-enabled individually via Edit after removing this restriction.</p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className={`px-4 py-2 rounded-lg text-sm font-medium ${marking ? "bg-red-700 hover:bg-red-800" : "bg-blue-700 hover:bg-blue-800"}`}>{marking ? "Mark Do Not Contact" : "Remove Restriction"}</button>
        </div>
      </form>
    </div>
  );
}
