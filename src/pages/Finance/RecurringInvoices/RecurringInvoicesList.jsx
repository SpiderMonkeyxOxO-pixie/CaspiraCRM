import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { Plus, X, RefreshCw } from "lucide-react";
import {
  fetchRecurringInvoices,
  createRecurringInvoice,
  toggleRecurringInvoice,
  generateNextInvoice,
  RECURRING_INTERVALS,
} from "../../../redux/finance/recurringInvoicesSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";

const emptyForm = { companyId: "", interval: "Monthly", itemName: "", amount: "" };

export default function RecurringInvoicesList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items: recurring, loading } = useSelector((s) => s.recurringInvoices);
  const companies = useSelector((s) => s.companies.items);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    dispatch(fetchRecurringInvoices());
    dispatch(fetchCompanies());
  }, [dispatch]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.companyId || !form.itemName || !form.amount) return;
    const company = companies.find((c) => c._id === form.companyId);
    await dispatch(createRecurringInvoice({
      companyId: form.companyId,
      companyName: company?.name,
      interval: form.interval,
      items: [{ name: form.itemName, qty: 1, unitPrice: Number(form.amount) }],
    }));
    setForm(emptyForm);
    setShowCreate(false);
  };

  const handleGenerate = async (id) => {
    const result = await dispatch(generateNextInvoice(id)).unwrap().catch(() => null);
    if (result?.invoice?._id) navigate(`/finance/invoices/${result.invoice._id}`);
  };

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Recurring Invoices</h1>
          <p className="text-sm text-gray-400 mt-1">{recurring.length} recurring templates · invoices are not created automatically: press Generate Now when one is due.</p>
        </div>
        <button data-tour="recurring-add" onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Recurring Invoice
        </button>
      </div>

      <div data-tour="recurring-table" className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading...</div>
        ) : recurring.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No recurring invoices set up yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Interval</th>
                <th className="px-4 py-3 font-medium">Generated</th>
                <th className="px-4 py-3 font-medium">Last Generated</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((r) => (
                <tr key={r._id} className="border-t border-gray-800">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/crm/companies/${r.companyId}`} className="hover:underline">{r.companyName}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{r.interval}</td>
                  <td className="px-4 py-3 text-gray-300">{r.invoicesGenerated || 0}</td>
                  <td className="px-4 py-3 text-gray-300">{r.lastGeneratedAt ? new Date(r.lastGeneratedAt).toLocaleDateString() : "Never"}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => dispatch(toggleRecurringInvoice({ id: r._id, active: !r.active }))}
                      className={`px-2 py-1 rounded-full text-xs border ${r.active ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-gray-500/15 text-gray-400 border-gray-500/30"}`}>
                      {r.active ? "Active" : "Paused"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleGenerate(r._id)} className="flex items-center gap-1 text-blue-400 hover:underline text-xs">
                      <RefreshCw size={12} /> Generate Now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">New Recurring Invoice</h2>
              <button type="button" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Company *</label>
              <select required value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select a company...</option>
                {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Line Item *</label>
              <input required value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} placeholder="e.g. Monthly subscription" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1 text-gray-300">Amount *</label>
                <input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-300">Interval</label>
                <select value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {RECURRING_INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
