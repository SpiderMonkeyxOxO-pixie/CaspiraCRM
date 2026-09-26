import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { fetchCreditNotes } from "../../../redux/finance/creditNotesSlice";

export default function CreditNotesList() {
  const dispatch = useDispatch();
  const { items: creditNotes, loading } = useSelector((s) => s.creditNotes);

  useEffect(() => {
    dispatch(fetchCreditNotes());
  }, [dispatch]);

  const total = creditNotes.reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="p-6 text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Credit Notes</h1>
        <p className="text-sm text-gray-400 mt-1">{creditNotes.length} credit notes · ${total.toLocaleString()} total issued</p>
      </div>

      <div data-tour="creditnotes-table" className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading credit notes...</div>
        ) : creditNotes.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No credit notes yet. Issue one from an invoice.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Credit Note #</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.map((c) => (
                <tr key={c._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/finance/invoices/${c.invoiceId}`} className="hover:underline">{c.creditNoteNumber}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{c.companyName}</td>
                  <td className="px-4 py-3 text-gray-300">${c.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{c.reason}</td>
                  <td className="px-4 py-3 text-gray-300">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
