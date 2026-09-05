import { useSelector } from "react-redux";
import { X } from "lucide-react";
import { computeQuoteTotals, computeLineTotal, getEffectiveStatus } from "../../../Helpers/mockQuoteData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatDate, QUOTE_STATUS_COLORS } from "./quoteUtils";

const TERM_FIELDS = [
  ["currency", "Currency"], ["priceBookId", "Price Book"], ["paymentTerms", "Payment Terms"],
  ["billingSchedule", "Billing Schedule"], ["validUntilDate", "Valid Until"],
];

export default function QuoteCompareDrawer({ quoteIds, onClose }) {
  const allQuotes = useSelector((s) => s.quotes.items);
  const containerRef = useFocusTrap(true, onClose);
  const [aId, bId] = quoteIds;
  const a = allQuotes.find((q) => q._id === aId);
  const b = allQuotes.find((q) => q._id === bId);

  if (!a || !b) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-sm text-gray-400">Select two versions to compare.</div>
      </div>
    );
  }

  const totalsA = computeQuoteTotals(a);
  const totalsB = computeQuoteTotals(b);
  const totalDifference = totalsB.grandTotal - totalsA.grandTotal;

  const keyOf = (l) => l.catalogItemId || l._id;
  const linesA = new Map((a.lineItems || []).map((l) => [keyOf(l), l]));
  const linesB = new Map((b.lineItems || []).map((l) => [keyOf(l), l]));
  const allKeys = [...new Set([...linesA.keys(), ...linesB.keys()])];

  const rows = allKeys.map((key) => {
    const la = linesA.get(key); const lb = linesB.get(key);
    const added = !la && !!lb;
    const removed = !!la && !lb;
    const quantityChanged = la && lb && la.quantity !== lb.quantity;
    const priceChanged = la && lb && la.unitPrice !== lb.unitPrice;
    const discountChanged = la && lb && (la.discountType !== lb.discountType || la.discountValue !== lb.discountValue);
    const taxChanged = la && lb && la.taxCategory !== lb.taxCategory;
    return { key, la, lb, added, removed, quantityChanged, priceChanged, discountChanged, taxChanged };
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end z-50" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Compare Quote versions" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border-l border-gray-800 w-full max-w-4xl h-full p-6 space-y-4 overflow-y-auto text-white">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Compare Versions — {a.quoteNumber}</h2>
          <button onClick={onClose} aria-label="Close comparison"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          {[a, b].map((q) => (
            <div key={q._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
              <p className="font-semibold">Version {q.version}{q._id === a._id ? " (baseline)" : " (comparison)"}</p>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs border ${QUOTE_STATUS_COLORS[getEffectiveStatus(q)]}`}>{getEffectiveStatus(q)}</span>
              <p className="text-gray-400 mt-1">Total: {formatMoney(computeQuoteTotals(q).grandTotal, q.currency)}</p>
            </div>
          ))}
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 text-sm">
          <p className="font-semibold mb-2">Term changes</p>
          {TERM_FIELDS.map(([field, label]) => {
            const va = field === "validUntilDate" ? formatDate(a[field]) : a[field];
            const vb = field === "validUntilDate" ? formatDate(b[field]) : b[field];
            const changed = a[field] !== b[field];
            return (
              <div key={field} className={`flex justify-between py-0.5 ${changed ? "text-amber-300" : "text-gray-400"}`}>
                <span>{label}</span><span>{String(va ?? "—")} {changed && `→ ${String(vb ?? "—")}`}</span>
              </div>
            );
          })}
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
              <th className="px-4 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Unit Price</th><th className="px-4 py-3 font-medium">Discount</th>
              <th className="px-4 py-3 font-medium">Tax</th><th className="px-4 py-3 font-medium">Total</th><th className="px-4 py-3 font-medium">Change</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const line = r.lb || r.la;
                const label = r.added ? "Added" : r.removed ? "Removed" : [r.quantityChanged && "Qty", r.priceChanged && "Price", r.discountChanged && "Discount", r.taxChanged && "Tax"].filter(Boolean).join(", ") || "Unchanged";
                return (
                  <tr key={r.key} className={`border-t border-gray-800 ${r.added ? "bg-emerald-900/10" : r.removed ? "bg-red-900/10" : ""}`}>
                    <td className="px-4 py-3 font-medium">{line?.name}</td>
                    <td className="px-4 py-3 text-gray-300">{r.lb?.quantity ?? r.la?.quantity ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{line ? formatMoney(line.unitPrice, b.currency) : "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{line?.discountType ? `${line.discountType === "Percentage" ? `${line.discountValue}%` : formatMoney(line.discountValue, b.currency)}` : "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{line?.taxCategory || "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{line ? formatMoney(computeLineTotal(line), b.currency) : "—"}</td>
                    <td className={`px-4 py-3 text-xs ${label === "Unchanged" ? "text-gray-500" : "text-amber-300"}`}>{label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 text-sm flex justify-between">
          <span className="text-gray-400">Total difference (v{b.version} vs v{a.version})</span>
          <span className={`font-semibold ${totalDifference > 0 ? "text-amber-300" : totalDifference < 0 ? "text-emerald-300" : ""}`}>
            {totalDifference >= 0 ? "+" : ""}{formatMoney(totalDifference, b.currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
