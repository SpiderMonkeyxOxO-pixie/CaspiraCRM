import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { fetchInvoices, INVOICE_STATUSES } from "../../../redux/finance/invoicesSlice";

const STATUS_COLORS = {
  Draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Approved: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Sent: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Partially Paid": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Overdue: "bg-red-500/15 text-red-300 border-red-500/30",
  Void: "bg-gray-500/15 text-gray-500 border-gray-500/30",
};

export default function InvoicesList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items: invoices, loading } = useSelector((s) => s.invoices);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    dispatch(fetchInvoices());
  }, [dispatch]);

  const filtered = useMemo(() => {
    return invoices
      .filter((i) => statusFilter === "All" || i.status === statusFilter)
      .filter((i) => !search || i.companyName?.toLowerCase().includes(search.toLowerCase()) || i.invoiceNumber?.toLowerCase().includes(search.toLowerCase()));
  }, [invoices, search, statusFilter]);

  const totalOutstanding = filtered.reduce((sum, i) => sum + (i.amountDue || 0), 0);

  return (
    <div className="p-6 text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <p className="text-sm text-gray-400 mt-1">{filtered.length} of {invoices.length} invoices · ${totalOutstanding.toLocaleString()} outstanding</p>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice #, company..."
            className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
          <option value="All">All Statuses</option>
          {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading invoices...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No invoices found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Amount Due</th>
                <th className="px-4 py-3 font-medium">Due Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i._id} onClick={() => navigate(`/finance/invoices/${i._id}`)} className="border-t border-gray-800 hover:bg-gray-800/40 cursor-pointer">
                  <td className="px-4 py-3 font-medium">{i.invoiceNumber}</td>
                  <td className="px-4 py-3 text-gray-300">{i.companyName}</td>
                  <td className="px-4 py-3 text-gray-300">${i.total?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-300">${i.amountDue?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-300">{new Date(i.dueDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[i.status]}`}>{i.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
