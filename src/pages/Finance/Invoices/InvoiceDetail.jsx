import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, Link } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ArrowLeft, ShieldCheck, Send, DollarSign, XCircle, FileMinus, Download } from "lucide-react";
import {
  fetchInvoice,
  approveInvoice,
  markInvoiceSent,
  voidInvoice,
  recordPayment,
  APPROVAL_THRESHOLD,
} from "../../../redux/finance/invoicesSlice";
import { createCreditNote } from "../../../redux/finance/creditNotesSlice";

export default function InvoiceDetail() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const invoice = useSelector((s) => s.invoices.current);
  const currentUser = useSelector((s) => s.auth.data);

  const [showPayment, setShowPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [showCredit, setShowCredit] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

  useEffect(() => {
    dispatch(fetchInvoice(id));
  }, [dispatch, id]);

  if (!invoice) return <div className="p-6 text-gray-400">Loading invoice...</div>;

  const needsApproval = invoice.total >= APPROVAL_THRESHOLD;
  const isFinal = ["Void"].includes(invoice.status);

  const handleApprove = () => dispatch(approveInvoice({ id: invoice._id, approver: currentUser?.name || currentUser?.username }));
  const handleSend = () => dispatch(markInvoiceSent(invoice._id));

  const submitPayment = (e) => {
    e.preventDefault();
    if (!paymentAmount || Number(paymentAmount) <= 0) return;
    dispatch(recordPayment({ id: invoice._id, amount: Number(paymentAmount), method: paymentMethod }));
    setPaymentAmount("");
    setShowPayment(false);
  };

  const submitVoid = (e) => {
    e.preventDefault();
    if (!voidReason.trim()) return;
    dispatch(voidInvoice({ id: invoice._id, reason: voidReason }));
    setShowVoid(false);
    setVoidReason("");
  };

  const submitCredit = (e) => {
    e.preventDefault();
    if (!creditAmount || !creditReason.trim()) return;
    dispatch(createCreditNote({ invoiceId: invoice._id, amount: Number(creditAmount), reason: creditReason }));
    setCreditAmount("");
    setCreditReason("");
    setShowCredit(false);
  };

  const downloadPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(invoice.invoiceNumber, 14, 16);
    doc.setFontSize(10);
    doc.text(`Bill To: ${invoice.companyName}`, 14, 24);
    doc.text(`Issue Date: ${new Date(invoice.issueDate).toLocaleDateString()}`, 14, 30);
    doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`, 14, 36);
    autoTable(doc, {
      startY: 42,
      head: [["Item", "Qty", "Unit Price", "Total"]],
      body: invoice.items.map((i) => [i.name, i.qty, `$${i.unitPrice.toLocaleString()}`, `$${(i.qty * i.unitPrice).toLocaleString()}`]),
    });
    const finalY = doc.lastAutoTable.finalY + 8;
    doc.text(`Subtotal: $${invoice.subtotal.toLocaleString()}`, 140, finalY);
    doc.text(`Tax: $${invoice.tax.toLocaleString()}`, 140, finalY + 6);
    doc.setFontSize(12);
    doc.text(`Total: $${invoice.total.toLocaleString()}`, 140, finalY + 14);
    doc.save(`${invoice.invoiceNumber}.pdf`);
  };

  return (
    <div className="p-6 text-white max-w-3xl">
      <Link to="/finance/invoices" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 w-fit">
        <ArrowLeft size={16} /> Back to Invoices
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold">{invoice.invoiceNumber}</h1>
          <p className="text-sm text-gray-400 mt-1">{invoice.companyName} · Due {new Date(invoice.dueDate).toLocaleDateString()}</p>
        </div>
        <button onClick={downloadPdf} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
          <Download size={16} /> Download PDF
        </button>
      </div>

      {!isFinal && (
        <div className="flex gap-2 flex-wrap mb-6">
          {invoice.status === "Draft" && (
            needsApproval ? (
              <button onClick={handleApprove} className="flex items-center gap-2 bg-amber-700 hover:bg-amber-800 px-4 py-2 rounded-lg text-sm">
                <ShieldCheck size={16} /> Approve (required, ≥ ${APPROVAL_THRESHOLD.toLocaleString()})
              </button>
            ) : (
              <button onClick={handleApprove} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm">
                <ShieldCheck size={16} /> Approve
              </button>
            )
          )}
          {invoice.status === "Approved" && (
            <button onClick={handleSend} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm">
              <Send size={16} /> Mark as Sent
            </button>
          )}
          {["Sent", "Partially Paid", "Overdue"].includes(invoice.status) && (
            <button onClick={() => setShowPayment(true)} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 px-4 py-2 rounded-lg text-sm">
              <DollarSign size={16} /> Record Payment
            </button>
          )}
          {invoice.amountPaid > 0 && (
            <button onClick={() => setShowCredit(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-4 py-2 rounded-lg text-sm">
              <FileMinus size={16} /> Issue Credit Note
            </button>
          )}
          <button onClick={() => setShowVoid(true)} className="flex items-center gap-2 border border-red-700 text-red-400 hover:bg-red-900/30 px-4 py-2 rounded-lg text-sm">
            <XCircle size={16} /> Void
          </button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap mb-6">
        <span className="px-3 py-1.5 rounded-full text-xs font-medium border bg-blue-500/15 text-blue-300 border-blue-500/30">{invoice.status}</span>
        {invoice.approvedBy && <span className="px-3 py-1.5 rounded-full text-xs border bg-gray-500/15 text-gray-300 border-gray-500/30">Approved by {invoice.approvedBy}</span>}
      </div>

      {invoice.voidReason && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4 mb-6 text-sm text-red-200">
          <strong>Void reason:</strong> {invoice.voidReason}
        </div>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Unit Price</th>
              <th className="px-4 py-3 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, i) => (
              <tr key={i} className="border-t border-gray-800">
                <td className="px-4 py-3">{item.name}</td>
                <td className="px-4 py-3 text-gray-300">{item.qty}</td>
                <td className="px-4 py-3 text-gray-300">${item.unitPrice?.toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-300">${(item.qty * item.unitPrice).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-gray-800 px-4 py-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>${invoice.subtotal?.toLocaleString()}</span></div>
          <div className="flex justify-between text-gray-400"><span>Tax</span><span>${invoice.tax?.toLocaleString()}</span></div>
          <div className="flex justify-between font-semibold text-base pt-1 border-t border-gray-800"><span>Total</span><span>${invoice.total?.toLocaleString()}</span></div>
          <div className="flex justify-between text-emerald-400"><span>Paid</span><span>${invoice.amountPaid?.toLocaleString()}</span></div>
          <div className="flex justify-between text-amber-400"><span>Amount Due</span><span>${invoice.amountDue?.toLocaleString()}</span></div>
        </div>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
        <h2 className="font-semibold mb-3">Payment History</h2>
        {invoice.payments?.length === 0 ? (
          <p className="text-sm text-gray-500">No payments recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {invoice.payments.map((p, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-gray-300">{p.method}</span>
                <span>${p.amount.toLocaleString()} · {new Date(p.date).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showPayment && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowPayment(false)}>
          <form onSubmit={submitPayment} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Record Payment</h2>
            <p className="text-xs text-gray-500">Amount due: ${invoice.amountDue?.toLocaleString()}</p>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Amount *</label>
              <input required type="number" step="0.01" max={invoice.amountDue} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Method</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {["Bank Transfer", "Credit Card", "Check", "Cash"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowPayment(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-sm font-medium">Record</button>
            </div>
          </form>
        </div>
      )}

      {showVoid && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowVoid(false)}>
          <form onSubmit={submitVoid} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Void Invoice</h2>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Reason *</label>
              <textarea required value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowVoid(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Void Invoice</button>
            </div>
          </form>
        </div>
      )}

      {showCredit && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCredit(false)}>
          <form onSubmit={submitCredit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Issue Credit Note</h2>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Amount *</label>
              <input required type="number" step="0.01" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Reason *</label>
              <textarea required value={creditReason} onChange={(e) => setCreditReason(e.target.value)} rows={3} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCredit(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Issue Credit Note</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
