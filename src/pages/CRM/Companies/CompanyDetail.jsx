import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Pencil, StickyNote, PhoneCall, CalendarClock, Archive, RotateCcw,
  Paperclip, MoreHorizontal, Mail, Phone, MapPin, ShieldAlert, CheckCircle2,
  TrendingUp, Wallet, ListChecks, Shield, Upload, Globe, Star, UserPlus, Trash2, Lock,
} from "lucide-react";
import {
  fetchCompany, assignCompanyOwner, changeCompanyLifecycle, changeCompanyHealth,
  addCompanyNote, logCompanyActivity, createCompanyTask, updateCompanyTask,
  uploadCompanyFile, deleteCompanyFile, archiveCompany, restoreCompany,
  linkContact, unlinkContact, setPrimaryContact,
  COMPANY_LIFECYCLE_STAGES, COMPANY_ACCOUNT_HEALTH,
} from "../../../redux/crm/companiesSlice";
import { fetchContacts, createContact } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchTickets } from "../../../redux/support/ticketsSlice";
import { fetchProjects } from "../../../redux/projects/projectsSlice";
import { fetchQuotes } from "../../../redux/sales/quotesSlice";
import { fetchOrders } from "../../../redux/sales/ordersSlice";
import { fetchInvoices } from "../../../redux/finance/invoicesSlice";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import CompanyFormModal from "./CompanyFormModal";
import HealthBadge from "./HealthBadge";

const TABS = ["overview", "contacts", "activity", "deals", "support", "projects", "finance", "tasks", "files", "audit"];
const TAB_LABELS = {
  overview: "Overview", contacts: "Contacts", activity: "Activity", deals: "Deals", support: "Support",
  projects: "Projects", finance: "Finance", tasks: "Tasks", files: "Files", audit: "Audit",
};
const ACTIVITY_ICONS = {
  created: StickyNote, note: StickyNote, call: PhoneCall, email: Mail, meeting: CalendarClock,
  task: ListChecks, owner_changed: TrendingUp, lifecycle_changed: TrendingUp, health_changed: ShieldAlert,
  contact_added: UserPlus, file_uploaded: Paperclip, archived: Archive, restored: RotateCcw,
};
const ACCOUNT_TYPE_COLORS = {
  Customer: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Prospect: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Former Customer": "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Partner: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Vendor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
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
  return name.slice(0, 2).toUpperCase();
}

export default function CompanyDetail() {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const { id } = useParams();
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const company = useSelector((s) => s.companies.current);
  const notFound = useSelector((s) => s.companies.currentNotFound);
  const isSuperAdmin = role === "Super-Admin";

  const [tab, setTab] = useState("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [modal, setModal] = useState(null);

  // linkContact/unlinkContact/setPrimaryContact mutate the underlying mock
  // record's companyId directly (in the companies slice's thunks), but the
  // Contacts slice's cached `items` isn't automatically refreshed — without
  // this, the Contacts tab keeps showing the pre-mutation relationship.
  const refreshContacts = () => dispatch(fetchContacts({ pageSize: 1000 }));

  useEffect(() => {
    dispatch(fetchCompany(id));
    dispatch(fetchContacts({ pageSize: 1000 }));
    dispatch(fetchDeals());
    dispatch(fetchTickets());
    dispatch(fetchProjects());
    dispatch(fetchQuotes());
    dispatch(fetchOrders());
    dispatch(fetchInvoices());
  }, [dispatch, id]);

  const allContacts = useSelector((s) => s.contacts.items);
  const allDeals = useSelector((s) => s.deals.items);
  const allTickets = useSelector((s) => s.tickets.items);
  const allProjects = useSelector((s) => s.projects.items);
  const allQuotes = useSelector((s) => s.quotes.items);
  const allOrders = useSelector((s) => s.orders.items);
  const allInvoices = useSelector((s) => s.invoices.items);

  const companyContacts = useMemo(() => allContacts.filter((c) => c.companyId === id), [allContacts, id]);
  const unlinkedContacts = useMemo(() => allContacts.filter((c) => c.companyId !== id), [allContacts, id]);
  const deals = useMemo(() => allDeals.filter((d) => d.companyId === id), [allDeals, id]);
  const tickets = useMemo(() => allTickets.filter((t) => t.companyId === id), [allTickets, id]);
  const projects = useMemo(() => allProjects.filter((p) => p.companyId === id), [allProjects, id]);
  const quotes = useMemo(() => allQuotes.filter((q) => q.companyId === id), [allQuotes, id]);
  const orders = useMemo(() => allOrders.filter((o) => o.companyId === id), [allOrders, id]);
  const invoices = useMemo(() => allInvoices.filter((inv) => inv.companyId === id), [allInvoices, id]);

  if (notFound) {
    return (
      <div className="p-6 text-white max-w-lg">
        <p className="text-lg font-semibold mb-1">Company not found</p>
        <p className="text-sm text-gray-400 mb-4">
          This company doesn't exist or is no longer available. This preview environment persists data in memory
          only, so a full page reload clears anything created during the session.
        </p>
        <Link to="/crm/companies" className="text-blue-400 hover:underline text-sm">Back to Companies</Link>
      </div>
    );
  }
  if (!company) return <CompanyDetailSkeleton />;

  const primaryContact = company.primaryContactId ? allContacts.find((c) => c._id === company.primaryContactId) : null;
  const sortedActivity = [...(company.activity || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  const lastActivity = sortedActivity[0]?.at || null;
  const upcomingTasks = (company.tasks || []).filter((t) => !t.completed && t.dueDate);
  const nextActivity = upcomingTasks.length
    ? upcomingTasks.reduce((min, t) => (new Date(t.dueDate) < new Date(min) ? t.dueDate : min), upcomingTasks[0].dueDate)
    : company.nextFollowUp;

  const closeModal = () => setModal(null);

  return (
    <div className="p-6 text-white max-w-6xl">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> /{" "}
        <Link to="/crm/companies" className="hover:text-gray-300">Companies</Link> / <span className="text-gray-300">{company.name}</span>
      </nav>
      <Link to="/crm/companies" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 w-fit">
        <ArrowLeft size={16} /> Back to Companies
      </Link>

      {company.archived && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-3 mb-4 text-sm text-gray-300 flex items-center justify-between">
          <span><strong>Archived:</strong> {company.archiveReason}</span>
          <button onClick={() => dispatch(restoreCompany(company._id))} className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 text-sm font-medium">
            <RotateCcw size={14} /> Restore
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-blue-900/40 border border-blue-700/40 flex items-center justify-center text-lg font-semibold text-blue-200 shrink-0">
            {initials(company.name)}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{company.name}</h1>
            <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-3 flex-wrap">
              {company.website && <a href={company.website} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1"><Globe size={12} />{company.primaryDomain || company.website}</a>}
              <span>{company.industry}</span>
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2" data-tour="company-badges">
              <span className={`px-2 py-1 rounded-full text-xs border ${ACCOUNT_TYPE_COLORS[company.accountType] || ACCOUNT_TYPE_COLORS.Prospect}`}>{company.accountType}</span>
              <span className="px-2 py-1 rounded-full text-xs border border-gray-700 text-gray-300 bg-gray-800/50">{company.lifecycleStage}</span>
              <span className="px-2 py-1 rounded-full text-xs border border-gray-700 text-gray-300 bg-gray-800/50">{company.accountTier}</span>
              <HealthBadge health={company.accountHealth} reason={company.healthReason} />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Owner: {company.ownerName || "Unassigned"} · Primary contact: {primaryContact?.name || "None"} · Last activity: {lastActivity ? new Date(lastActivity).toLocaleDateString() : "—"} · Next: {nextActivity ? new Date(nextActivity).toLocaleDateString() : "—"}
            </p>
          </div>
        </div>

        {!company.archived && (
          <div className="flex gap-2 flex-wrap items-start" data-tour="company-actions">
            <button onClick={() => setShowEdit(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Pencil size={14} /> Edit</button>
            <button onClick={() => setModal("addContact")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><UserPlus size={14} /> Add Contact</button>
            <button onClick={() => setModal("note")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><StickyNote size={14} /> Add Note</button>
            <button onClick={() => setModal("activity")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><PhoneCall size={14} /> Log Activity</button>
            {!BACKEND_CRM_SALES_MODE_ENABLED && <button onClick={() => setModal("task")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><ListChecks size={14} /> Create Task</button>}
            <button onClick={() => setModal("meeting")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><CalendarClock size={14} /> Schedule Meeting</button>
            <div className="relative">
              <button data-tour="company-more" onClick={() => setShowMore((v) => !v)} aria-haspopup="menu" aria-expanded={showMore} className="p-2 border border-gray-700 hover:bg-gray-800 rounded-lg"><MoreHorizontal size={16} /></button>
              {showMore && (
                <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-48 shadow-xl">
                  <button role="menuitem" onClick={() => { setModal("owner"); setShowMore(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Change Owner</button>
                  <button role="menuitem" onClick={() => { setModal("lifecycle"); setShowMore(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Change Lifecycle</button>
                  <button role="menuitem" onClick={() => { setModal("health"); setShowMore(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Change Account Health</button>
                  <button role="menuitem" onClick={() => { setModal("archive"); setShowMore(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 text-red-400">Archive</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-800 mb-4 overflow-x-auto" data-tour="company-tabs">
        {TABS.filter((t) => !(BACKEND_CRM_SALES_MODE_ENABLED && (t === "tasks" || t === "files"))).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm whitespace-nowrap ${tab === t ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {t === "audit" ? <span className="flex items-center gap-1"><Shield size={14} /> Audit</span> : TAB_LABELS[t]}
            {t === "contacts" && companyContacts.length > 0 && <span className="ml-1 text-gray-500">({companyContacts.length})</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab company={company} primaryContact={primaryContact} dealsCount={deals.length} ticketsCount={tickets.length} projectsCount={projects.length} />}
      {tab === "contacts" && (
        <ContactsTab
          company={company} contacts={companyContacts}
          onMarkPrimary={(contactId) => dispatch(setPrimaryContact({ id: company._id, contactId })).then(refreshContacts)}
          onRemove={(contactId) => dispatch(unlinkContact({ id: company._id, contactId })).then(refreshContacts)}
          onAdd={() => setModal("addContact")}
        />
      )}
      {tab === "activity" && <ActivityTab activity={sortedActivity} />}
      {tab === "deals" && <DealsTab deals={deals} />}
      {tab === "support" && <SupportTab tickets={tickets} />}
      {tab === "projects" && <ProjectsTab projects={projects} />}
      {tab === "finance" && <FinanceTab quotes={quotes} orders={orders} invoices={invoices} allowed={isSuperAdmin} company={company} />}
      {tab === "tasks" && <TasksTab company={company} onToggle={(taskId, completed) => dispatch(updateCompanyTask({ id: company._id, taskId, changes: { completed: !completed } }))} onAdd={() => setModal("task")} />}
      {tab === "files" && (
        <FilesTab
          company={company}
          onUpload={async (file) => {
            const dataUrl = await fileToDataUrl(file);
            dispatch(uploadCompanyFile({ id: company._id, file: { name: file.name, size: file.size, type: file.type, dataUrl } }));
          }}
          onDelete={(fileId) => dispatch(deleteCompanyFile({ id: company._id, fileId }))}
        />
      )}
      {tab === "audit" && <AuditTab auditLog={company.auditLog || []} />}

      {showEdit && <CompanyFormModal company={company} onClose={() => setShowEdit(false)} />}

      {modal === "note" && (
        <SimpleFormModal title="Add Note" onClose={closeModal} onSubmit={(text) => { dispatch(addCompanyNote({ id: company._id, message: text })); closeModal(); }}>
          {(value, setValue) => <textarea autoFocus required value={value} onChange={(e) => setValue(e.target.value)} rows={3} placeholder="Add a note about this company..." className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />}
        </SimpleFormModal>
      )}

      {(modal === "activity" || modal === "meeting") && (
        <LogActivityModal forcedType={modal === "meeting" ? "meeting" : undefined} title={modal === "meeting" ? "Schedule Meeting" : "Log Activity"} onClose={closeModal}
          onSubmit={(type, description) => { dispatch(logCompanyActivity({ id: company._id, type, description })); closeModal(); }} />
      )}

      {modal === "task" && (
        <TaskFormModal onClose={closeModal} onSubmit={(task) => { dispatch(createCompanyTask({ id: company._id, task })); closeModal(); }} />
      )}

      {modal === "owner" && (
        <SelectFormModal title="Change Owner" options={crmTeam.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))} initial={company.ownerId} onClose={closeModal}
          onSubmit={(ownerId) => { dispatch(assignCompanyOwner({ id: company._id, ownerId })); closeModal(); }} />
      )}

      {modal === "lifecycle" && (
        <SelectFormModal title="Change Lifecycle" options={COMPANY_LIFECYCLE_STAGES.map((l) => ({ value: l, label: l }))} initial={company.lifecycleStage} onClose={closeModal}
          onSubmit={(lifecycleStage) => { dispatch(changeCompanyLifecycle({ id: company._id, lifecycleStage })); closeModal(); }} />
      )}

      {modal === "health" && (
        <HealthFormModal company={company} onClose={closeModal}
          onSubmit={(accountHealth, healthReason) => { dispatch(changeCompanyHealth({ id: company._id, accountHealth, healthReason })); closeModal(); }} />
      )}

      {modal === "archive" && (
        <SimpleFormModal title="Archive Company" submitLabel="Archive" danger onClose={closeModal} onSubmit={(reason) => { dispatch(archiveCompany({ id: company._id, reason })); closeModal(); }}>
          {(value, setValue) => (
            <>
              <p className="text-sm text-gray-400">
                Archiving <strong className="text-white">{company.name}</strong> moves it out of the active directory for this session.
                Associated contacts, deals, tickets and other records remain available and are not deleted.
              </p>
              <textarea autoFocus required value={value} onChange={(e) => setValue(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </>
          )}
        </SimpleFormModal>
      )}

      {modal === "addContact" && (
        <AddContactModal
          unlinkedContacts={unlinkedContacts}
          onClose={closeModal}
          onLinkExisting={(contactId) => { dispatch(linkContact({ id: company._id, contactId })).then(refreshContacts); closeModal(); }}
          onCreateNew={async (payload) => {
            const result = await dispatch(createContact(payload));
            if (createContact.fulfilled.match(result)) await dispatch(linkContact({ id: company._id, contactId: result.payload._id }));
            refreshContacts();
            closeModal();
          }}
        />
      )}
    </div>
  );
}

function CompanyDetailSkeleton() {
  return (
    <div className="p-6 text-white max-w-6xl animate-pulse">
      <div className="h-3 w-40 bg-gray-800 rounded mb-4" />
      <div className="flex items-start gap-4 mb-6">
        <div className="w-14 h-14 rounded-xl bg-gray-800" />
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

function OverviewTab({ company, primaryContact, dealsCount, ticketsCount, projectsCount }) {
  const Row = ({ label, value }) => (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-800/60 last:border-0">
      <dt className="text-gray-400 shrink-0">{label}</dt>
      <dd className="text-right min-w-0 truncate" title={typeof value === "string" ? value : undefined}>{value ?? "—"}</dd>
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase mb-1">Open Deals</p>
          <p className="text-xl font-bold">{dealsCount}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase mb-1">Open Tickets</p>
          <p className="text-xl font-bold">{ticketsCount}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase mb-1">Active Projects</p>
          <p className="text-xl font-bold">{projectsCount}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase mb-1">Est. Annual Value</p>
          <p className="text-xl font-bold">${company.estimatedAnnualValue?.toLocaleString()}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold mb-3">Company Information</h2>
          <dl className="text-sm">
            <Row label="Industry" value={company.industry} />
            <Row label="Company Size" value={company.companySize} />
            <Row label="Website" value={company.website ? <a href={company.website} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{company.website}</a> : "—"} />
            <Row label="Email" value={<span className="flex items-center gap-1.5 justify-end min-w-0"><Mail size={13} className="text-gray-500 shrink-0" /><span className="truncate">{company.email || "—"}</span></span>} />
            <Row label="Phone" value={<span className="flex items-center gap-1.5 justify-end min-w-0"><Phone size={13} className="text-gray-500 shrink-0" /><span className="truncate">{company.phone || "—"}</span></span>} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold mb-3">Address &amp; Location</h2>
          <dl className="text-sm">
            <Row label="Address" value={<span className="flex items-center gap-1.5 justify-end min-w-0"><MapPin size={13} className="text-gray-500 shrink-0" /><span className="truncate">{company.address || "—"}</span></span>} />
            <Row label="City" value={company.city} />
            <Row label="Region" value={company.region} />
            <Row label="Country" value={company.country} />
            <Row label="Time Zone" value={company.timezone} />
            <Row label="Preferred Language" value={company.preferredLanguage} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold mb-3">Ownership &amp; Classification</h2>
          <dl className="text-sm">
            <Row label="Account Owner" value={company.ownerName || "Unassigned"} />
            <Row label="Assigned Team" value={company.assignedTeam} />
            <Row label="Account Type" value={company.accountType} />
            <Row label="Lifecycle Stage" value={company.lifecycleStage} />
            <Row label="Customer Status" value={company.customerStatus} />
            <Row label="Account Tier" value={company.accountTier} />
            <Row label="Source" value={company.source} />
          </dl>
          {company.tags?.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-gray-800">
              {company.tags.map((t) => <span key={t} className="px-2 py-1 rounded-full text-xs bg-gray-800 text-gray-300">{t}</span>)}
            </div>
          )}
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold mb-3">Primary Contact &amp; Commercial</h2>
          <dl className="text-sm">
            <Row label="Primary Contact" value={primaryContact ? <Link to={`/crm/contacts/${primaryContact._id}`} className="text-blue-400 hover:underline">{primaryContact.name}</Link> : "None"} />
            <Row label="Est. Annual Value" value={`${company.currency} ${company.estimatedAnnualValue?.toLocaleString()}`} />
            <Row label="Renewal Date" value={company.renewalDate ? new Date(company.renewalDate).toLocaleDateString() : "—"} />
            <Row label="Next Follow-up" value={company.nextFollowUp ? new Date(company.nextFollowUp).toLocaleDateString() : "—"} />
          </dl>
          <div className="pt-3 mt-3 border-t border-gray-800 text-xs text-gray-500">
            Created {new Date(company.createdAt).toLocaleString()} by {company.createdBy} · Updated {new Date(company.updatedAt).toLocaleString()} by {company.updatedBy}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactsTab({ contacts, onMarkPrimary, onRemove, onAdd }) {
  const [confirmRemove, setConfirmRemove] = useState(null);
  const company = useSelector((s) => s.companies.current);
  if (contacts.length === 0) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
        <UserPlus size={22} className="mx-auto mb-2 text-gray-600" />
        <p className="text-sm mb-3">No contacts linked to this company yet.</p>
        <button onClick={onAdd} className="text-blue-400 hover:underline text-sm">Add Contact</button>
      </div>
    );
  }
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <div className="flex justify-end p-3 border-b border-gray-800">
        <button onClick={onAdd} className="text-sm text-blue-400 hover:underline">+ Add Contact</button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">Job Title</th>
          <th className="px-4 py-3 font-medium">Decision Role</th><th className="px-4 py-3 font-medium">Email</th>
          <th className="px-4 py-3 font-medium">Phone</th><th className="px-4 py-3 font-medium">Relationship</th>
          <th className="px-4 py-3 font-medium">Last Activity</th><th className="px-4 py-3 font-medium">Actions</th>
        </tr></thead>
        <tbody>
          {contacts.map((c) => {
            const isPrimary = company?.primaryContactId === c._id;
            const last = (c.activity || [])[0]?.at;
            return (
              <tr key={c._id} className="border-t border-gray-800">
                <td className="px-4 py-3 font-medium">
                  <Link to={`/crm/contacts/${c._id}`} className="hover:text-blue-300">{c.name}</Link>
                  {isPrimary && <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-300"><Star size={11} fill="currentColor" /> Primary</span>}
                </td>
                <td className="px-4 py-3 text-gray-300">{c.jobTitle}</td>
                <td className="px-4 py-3 text-gray-300">{c.decisionMakingRole}</td>
                <td className="px-4 py-3 text-gray-300">{c.email}</td>
                <td className="px-4 py-3 text-gray-300">{c.phone}</td>
                <td className="px-4 py-3 text-gray-300">{c.relationshipType}</td>
                <td className="px-4 py-3 text-gray-300">{last ? new Date(last).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {!isPrimary && <button onClick={() => onMarkPrimary(c._id)} className="text-xs text-blue-400 hover:underline">Mark Primary</button>}
                    <button onClick={() => setConfirmRemove(c)} className="text-xs text-red-400 hover:underline flex items-center gap-1"><Trash2 size={11} /> Remove</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {confirmRemove && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setConfirmRemove(null)}>
          <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold">Remove {confirmRemove.name}?</h3>
            <p className="text-sm text-gray-400">This removes the relationship between this contact and this company. The contact record itself is not deleted.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRemove(null)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button onClick={() => { onRemove(confirmRemove._id); setConfirmRemove(null); }} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
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
                  <p className="text-xs text-gray-500">{event.type.replace("_", " ")} · {event.actor} · {new Date(event.at).toLocaleString()}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
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

function DealsTab({ deals }) {
  if (deals.length === 0) return <EmptyPanel icon={TrendingUp} text="No deals linked to this company yet." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Deal</th><th className="px-4 py-3 font-medium">Stage</th>
          <th className="px-4 py-3 font-medium">Value</th><th className="px-4 py-3 font-medium">Owner</th>
          <th className="px-4 py-3 font-medium">Probability</th><th className="px-4 py-3 font-medium">Expected Close</th><th className="px-4 py-3 font-medium">Status</th>
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
              <td className="px-4 py-3 text-gray-300">{d.probability}%</td>
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
  const OPEN = ["New", "Open", "In Progress", "Waiting for Customer"];
  const open = tickets.filter((t) => OPEN.includes(t.status));
  const urgent = tickets.filter((t) => t.priority === "Urgent" && OPEN.includes(t.status));
  const waiting = tickets.filter((t) => t.status === "Waiting for Customer");
  const resolvedThisMonth = tickets.filter((t) => t.resolution?.resolvedAt && new Date(t.resolution.resolvedAt).getMonth() === new Date().getMonth());
  if (tickets.length === 0) return <EmptyPanel icon={ListChecks} text="No support tickets linked to this company." />;
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400 uppercase mb-1">Open</p><p className="text-xl font-bold">{open.length}</p></div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400 uppercase mb-1">Urgent</p><p className={`text-xl font-bold ${urgent.length ? "text-red-400" : ""}`}>{urgent.length}</p></div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400 uppercase mb-1">Waiting for Customer</p><p className="text-xl font-bold">{waiting.length}</p></div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400 uppercase mb-1">Resolved this Month</p><p className="text-xl font-bold">{resolvedThisMonth.length}</p></div>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
            <th className="px-4 py-3 font-medium">Ticket</th><th className="px-4 py-3 font-medium">Subject</th>
            <th className="px-4 py-3 font-medium">Priority</th><th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Agent</th><th className="px-4 py-3 font-medium">SLA</th><th className="px-4 py-3 font-medium">Last Update</th>
          </tr></thead>
          <tbody>
            {tickets.map((t) => {
              const breached = !t.resolution && new Date(t.slaResponseDeadline) < new Date();
              return (
                <tr key={t._id} className="border-t border-gray-800">
                  <td className="px-4 py-3 font-medium">{t.ticketNumber}</td>
                  <td className="px-4 py-3 text-gray-300">{t.subject}</td>
                  <td className="px-4 py-3 text-gray-300">{t.priority}</td>
                  <td className="px-4 py-3 text-gray-300">{t.status}</td>
                  <td className="px-4 py-3 text-gray-300">{t.assignedAgent || "Unassigned"}</td>
                  <td className="px-4 py-3">{breached ? <span className="text-red-400 text-xs">Breached</span> : <span className="text-emerald-400 text-xs">On Track</span>}</td>
                  <td className="px-4 py-3 text-gray-300">{new Date(t.resolution?.resolvedAt || t.createdAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectsTab({ projects }) {
  if (projects.length === 0) return <EmptyPanel icon={ListChecks} text="No projects linked to this company." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Project</th><th className="px-4 py-3 font-medium">Status</th>
          <th className="px-4 py-3 font-medium">Progress</th><th className="px-4 py-3 font-medium">Manager</th>
          <th className="px-4 py-3 font-medium">Next Milestone</th><th className="px-4 py-3 font-medium">Due</th>
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
                  <div className="flex items-center gap-2"><div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${progress}%` }} /></div><span className="text-xs">{progress}%</span></div>
                </td>
                <td className="px-4 py-3 text-gray-300">{p.owner}</td>
                <td className="px-4 py-3 text-gray-300">{next ? next.name : "Complete"}</td>
                <td className="px-4 py-3 text-gray-300">{p.dueDate ? new Date(p.dueDate).toLocaleDateString() : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FinanceTab({ quotes, orders, invoices, allowed }) {
  if (!allowed) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-400">
        <Lock size={22} className="mx-auto mb-2 text-gray-600" />
        <p className="text-sm font-medium text-gray-300 mb-1">Financial information is restricted</p>
        <p className="text-xs text-gray-500">Quotes, orders, invoices and payments require System Owner access. Switch roles (?as=superadmin) to preview this section.</p>
      </div>
    );
  }
  const outstandingBalance = invoices.reduce((sum, inv) => sum + (inv.amountDue || 0), 0);
  if (quotes.length === 0 && orders.length === 0 && invoices.length === 0) {
    return <EmptyPanel icon={Wallet} text="No quotes, orders or invoices linked to this company yet." />;
  }
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase mb-1">Outstanding Balance</p>
          <p className={`text-xl font-bold ${outstandingBalance > 0 ? "text-amber-300" : ""}`}>${outstandingBalance.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase mb-1">Invoices</p>
          <p className="text-xl font-bold">{invoices.length}</p>
        </div>
      </div>
      {quotes.length > 0 && <FinanceSection title="Quotes" rows={quotes} cols={["quoteNumber", "status", "total"]} labels={["Quote", "Status", "Total"]} />}
      {orders.length > 0 && <FinanceSection title="Orders" rows={orders} cols={["orderNumber", "status", "total"]} labels={["Order", "Status", "Total"]} />}
      {invoices.length > 0 && <FinanceSection title="Invoices" rows={invoices} cols={["invoiceNumber", "status", "amountDue"]} labels={["Invoice", "Payment Status", "Amount Due"]} />}
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
              {cols.map((c) => <td key={c} className="px-4 py-3 text-gray-300">{typeof r[c] === "number" ? `$${r[c].toLocaleString()}` : r[c]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TasksTab({ company, onToggle, onAdd }) {
  const tasks = company.tasks || [];
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
      {tasks.length === 0 ? <p className="text-sm text-gray-500">No tasks yet.</p> : (
        <>
          <Section title="Overdue" items={overdue} colorClass="text-red-400" />
          <Section title="Open" items={open} />
          <Section title="Completed" items={completed} colorClass="text-gray-500" />
        </>
      )}
    </div>
  );
}

function FilesTab({ company, onUpload, onDelete }) {
  const files = company.files || [];
  const handleDrop = (e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onUpload(file); };
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold">Files</h2>
        <label className="text-sm text-blue-400 hover:underline cursor-pointer">+ Upload File<input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} /></label>
      </div>
      <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} className="border-2 border-dashed border-gray-700 rounded-xl p-6 mb-4 text-center text-sm text-gray-500 flex flex-col items-center gap-2">
        <Upload size={18} /> Drag and drop a file here, or use "Upload File" above.
      </div>
      {files.length === 0 ? <p className="text-sm text-gray-500">No files uploaded yet.</p> : (
        <ul className="space-y-2">
          {files.map((file) => (
            <li key={file._id} className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3 text-sm">
              <div>
                <a href={file.dataUrl} download={file.name} className="text-blue-300 hover:underline">{file.name}</a>
                <p className="text-xs text-gray-500">{file.type || "file"} · {(file.size / 1024).toFixed(1)} KB · v{file.version || 1} · uploaded by {file.uploadedBy} on {new Date(file.uploadedAt).toLocaleDateString()}</p>
              </div>
              <button onClick={() => onDelete(file._id)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
            </li>
          ))}
        </ul>
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

function SimpleFormModal({ title, submitLabel = "Save", danger, onClose, onSubmit, children }) {
  const [value, setValue] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = (e) => { e.preventDefault(); if (!value.trim()) return; onSubmit(value); };
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

function LogActivityModal({ forcedType, title = "Log Activity", onClose, onSubmit }) {
  const [type, setType] = useState(forcedType || "call");
  const [description, setDescription] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = (e) => { e.preventDefault(); if (!description.trim()) return; onSubmit(type, description); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{title}</h2>
        {!forcedType && (
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {["call", "email", "meeting", "note"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
        )}
        <textarea autoFocus required value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What happened?" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
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
  const submit = (e) => { e.preventDefault(); if (!title.trim() || !dueDate) return; onSubmit({ title, dueDate, priority }); };
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
  const submit = (e) => { e.preventDefault(); if (!value) return; onSubmit(value); };
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

function HealthFormModal({ company, onClose, onSubmit }) {
  const [health, setHealth] = useState(company.accountHealth);
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = (e) => { e.preventDefault(); onSubmit(health, reason); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Change Account Health" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Change Account Health</h2>
        <select autoFocus value={health} onChange={(e) => setHealth(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          {COMPANY_ACCOUNT_HEALTH.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. Renewal approaching)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
        </div>
      </form>
    </div>
  );
}

function AddContactModal({ unlinkedContacts, onClose, onLinkExisting, onCreateNew }) {
  const [mode, setMode] = useState("existing");
  const [contactId, setContactId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const containerRef = useFocusTrap(true, onClose);

  const submit = (e) => {
    e.preventDefault();
    if (mode === "existing") {
      if (!contactId) return;
      onLinkExisting(contactId);
    } else {
      const [firstName, ...rest] = name.trim().split(" ");
      if (!firstName) return;
      onCreateNew({ firstName, lastName: rest.join(" "), email: email.trim(), phone: phone.trim(), relationshipType: "Prospect", lifecycleStage: "New", source: "Website" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Add Contact" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Add Contact</h2>
        <div className="flex gap-1 bg-gray-800/60 rounded-lg p-1">
          <button type="button" onClick={() => setMode("existing")} className={`flex-1 text-sm py-1.5 rounded ${mode === "existing" ? "bg-blue-700" : ""}`}>Existing Contact</button>
          <button type="button" onClick={() => setMode("new")} className={`flex-1 text-sm py-1.5 rounded ${mode === "new" ? "bg-blue-700" : ""}`}>New Contact</button>
        </div>
        {mode === "existing" ? (
          <select autoFocus value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select a contact...</option>
            {unlinkedContacts.map((c) => <option key={c._id} value={c._id}>{c.name}{c.companyName ? ` (currently at ${c.companyName})` : ""}</option>)}
          </select>
        ) : (
          <>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Add</button>
        </div>
      </form>
    </div>
  );
}
