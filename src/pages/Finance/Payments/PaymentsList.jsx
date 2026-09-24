import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Info } from "lucide-react";
import { fetchInvoices } from "../../../redux/finance/invoicesSlice";
import * as api from "../../../Helpers/backendFinanceClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { useFinanceAccess } from "../../../Helpers/financeAccess";
import { errorText } from "../../../Helpers/financeActions";
import { NoAccess, PageHeader, StatusBadge } from "../financeUi";
import { money, day } from "../financeFormat";

// Backend mode: payments are records with their own lifecycle
// (Draft → Approved → Posted), allocated to invoices or bills.
function BackendPayments() {
  const access = useFinanceAccess();
  const [payments, setPayments] = useState(null);
  const [status, setStatus] = useState("All");

  useEffect(() => {
    api.listPayments(orgId(), { pageSize: 100, ...(status !== "All" && { status }) })
      .then((r) => setPayments(r.payments || []))
      .catch((error) => { toast.error(errorText(error, "Couldn't load payments.")); setPayments([]); });
  }, [status]);

  if (!access.loading && !access.can("payments", "view")) return <NoAccess what="payments" />;

  return (
    <div className="p-6 text-white">
      <PageHeader
        title="Payments"
        subtitle="Payments recorded in the CRM. They change what an invoice or bill owes only after they are approved and posted."
        actions={<Link to="/finance/approvals" className="px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm">Approvals &amp; Posting</Link>}
      />
      <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-800/40 rounded-xl p-3 mb-4 text-sm text-blue-100">
        <Info size={16} className="shrink-0 mt-0.5" />
        Recorded payment — no bank or payment-provider transfer was performed.
      </div>
      <div className="mb-4">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          {["All", "Draft", "Submitted", "Approved", "Posted", "Reversed", "Cancelled", "Legacy Recorded"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {payments === null ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : payments.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No payments.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Number</th>
                  <th className="px-4 py-3 font-medium">Direction</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium text-right">Unallocated</th>
                  <th className="px-4 py-3 font-medium">Applied to</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-medium">{p.paymentNumber || "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{p.direction}</td>
                    <td className="px-4 py-3 text-gray-300">{day(p.date)}</td>
                    <td className="px-4 py-3 text-gray-300">{p.method}</td>
                    <td className="px-4 py-3 text-right text-emerald-400">{money(p.amount, p.currency)}</td>
                    <td className="px-4 py-3 text-right text-gray-400">{money(p.unallocatedAmount, p.currency)}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {(p.allocations || []).filter((a) => a.status !== "Reversed").map((a) => (
                        a.invoiceId
                          ? <Link key={a._id} to={`/finance/invoices/${a.invoiceId}`} className="block hover:underline">Invoice · {money(a.amount)}{a.status === "Pending" ? " (on posting)" : ""}</Link>
                          : <span key={a._id} className="block">Bill · {money(a.amount)}{a.status === "Pending" ? " (on posting)" : ""}</span>
                      ))}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MockPayments() {
  const dispatch = useDispatch();
  const invoices = useSelector((s) => s.invoices.items);

  useEffect(() => {
    dispatch(fetchInvoices());
  }, [dispatch]);

  const payments = invoices
    .flatMap((inv) => (inv.payments || []).map((p) => ({ ...p, invoiceId: inv._id, invoiceNumber: inv.invoiceNumber, companyName: inv.companyName })))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const total = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="p-6 text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-sm text-gray-400 mt-1">{payments.length} payments recorded · ${total.toLocaleString()} total</p>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {payments.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No payments recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/finance/invoices/${p.invoiceId}`} className="hover:underline">{p.invoiceNumber}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{p.companyName}</td>
                  <td className="px-4 py-3 text-emerald-400">${p.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-300">{p.method}</td>
                  <td className="px-4 py-3 text-gray-300">{new Date(p.date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function PaymentsList() {
  return api.BACKEND_FINANCE_MODE_ENABLED ? <BackendPayments /> : <MockPayments />;
}
