import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import {
  fetchTickets,
  createTicket,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_CATEGORIES,
  TICKET_SOURCES,
} from "../../../redux/support/ticketsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { getSlaStatus, SLA_LABELS, SLA_COLORS } from "../slaUtils";

const PRIORITY_COLORS = {
  Low: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Medium: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  High: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Urgent: "bg-red-500/15 text-red-300 border-red-500/30",
};

const emptyForm = { companyId: "", contactId: "", subject: "", description: "", source: "Email", category: "General", priority: "Medium" };

export default function TicketsList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { items: tickets, loading } = useSelector((s) => s.tickets);
  const companies = useSelector((s) => s.companies.items);
  const contacts = useSelector((s) => s.contacts.items);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "All");
  const [priorityFilter, setPriorityFilter] = useState(searchParams.get("priority") || "All");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    dispatch(fetchTickets());
    dispatch(fetchCompanies());
    // Contacts are now paginated; this page needs the full roster for the
    // company-scoped contact picker in the create-ticket form.
    dispatch(fetchContacts({ pageSize: 1000 }));
  }, [dispatch]);

  const filtered = useMemo(() => {
    return tickets
      .filter((t) => statusFilter === "All" || t.status === statusFilter)
      .filter((t) => priorityFilter === "All" || t.priority === priorityFilter)
      .filter((t) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return t.subject?.toLowerCase().includes(q) || t.companyName?.toLowerCase().includes(q) || t.ticketNumber?.toLowerCase().includes(q);
      });
  }, [tickets, search, statusFilter, priorityFilter]);

  const companyContacts = contacts.filter((c) => c.companyId === form.companyId);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.companyId || !form.subject) return;
    const company = companies.find((c) => c._id === form.companyId);
    const contact = contacts.find((c) => c._id === form.contactId);
    await dispatch(createTicket({
      ...form,
      companyName: company?.name,
      contactName: contact?.name,
    }));
    setForm(emptyForm);
    setShowCreate(false);
  };

  return (
    <div className="p-6 text-white">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tickets</h1>
          <p className="text-sm text-gray-400 mt-1">{filtered.length} of {tickets.length} tickets</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium self-start">
          <Plus size={16} /> New Ticket
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subject, company, ticket #..."
            className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
          <option value="All">All Statuses</option>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
          <option value="All">All Priorities</option>
          {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading tickets...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <p className="mb-2">No tickets found</p>
            <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:underline text-sm">Create your first ticket</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Response SLA</th>
                <th className="px-4 py-3 font-medium">Agent</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const slaStatus = getSlaStatus(t.slaResponseDeadline, !!t.firstRespondedAt);
                return (
                  <tr key={t._id} onClick={() => navigate(`/support/tickets/${t._id}`)} className="border-t border-gray-800 hover:bg-gray-800/40 cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="font-medium">{t.ticketNumber}</div>
                      <div className="text-xs text-gray-500 max-w-xs truncate">{t.subject}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{t.companyName}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs border ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{t.status}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs border ${SLA_COLORS[slaStatus]}`}>{SLA_LABELS[slaStatus]}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{t.assignedAgent || <span className="text-gray-600">Unassigned</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">New Ticket</h2>
              <button type="button" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Company *</label>
              <select required value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value, contactId: "" })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select a company...</option>
                {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            {companyContacts.length > 0 && (
              <div>
                <label className="block text-sm mb-1 text-gray-300">Contact</label>
                <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select a contact...</option>
                  {companyContacts.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm mb-1 text-gray-300">Subject *</label>
              <input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm mb-1 text-gray-300">Source</label>
                <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {TICKET_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-300">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-300">Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create Ticket</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
