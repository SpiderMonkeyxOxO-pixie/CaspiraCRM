import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { fetchInvoices } from "../../../redux/finance/invoicesSlice";

export default function PaymentsList() {
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
