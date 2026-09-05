import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { X } from "lucide-react";
import { findCatalogItem } from "../../../Helpers/mockCatalogData";
import { computeEntryFinalPrice, describeApplicability, getEffectiveStatus } from "../../../Helpers/mockPriceBookData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatDate, formatPercent, PB_STATUS_COLORS } from "./priceBookUtils";

const LARGE_DIFFERENCE_THRESHOLD = 20; // percent

// Compares 2-3 Price Books side by side: currency, applicability, dates,
// priority, shared/missing items, base vs. final prices and % differences.
export default function CompareDrawer({ priceBookIds, onClose }) {
  const allPriceBooks = useSelector((s) => s.priceBooks.items);
  const [ids, setIds] = useState(priceBookIds.slice(0, 3));
  const [filter, setFilter] = useState("all"); // all | changed | shared | missing | large
  const containerRef = useFocusTrap(true, onClose);

  const books = ids.map((id) => allPriceBooks.find((p) => p._id === id)).filter(Boolean);

  const itemIds = useMemo(() => {
    const set = new Set();
    books.forEach((b) => (b.items || []).forEach((i) => set.add(i.catalogItemId)));
    return [...set];
  }, [books]);

  const rows = useMemo(() => itemIds.map((catalogItemId) => {
    const catalogItem = findCatalogItem(catalogItemId);
    const perBook = books.map((b) => {
      const entry = (b.items || []).find((i) => i.catalogItemId === catalogItemId);
      const priced = entry && catalogItem ? computeEntryFinalPrice(entry, catalogItem, entry.minQuantity || 1) : null;
      return { book: b, entry, priced };
    });
    const present = perBook.filter((p) => p.entry);
    const isShared = present.length === books.length;
    const isMissing = present.length > 0 && present.length < books.length;
    const finalPrices = present.map((p) => p.priced?.finalPrice).filter((v) => v != null);
    const sameCurrencyAcross = present.every((p) => p.priced?.sameCurrency !== false) && new Set(present.map((p) => p.entry.currency)).size === 1;
    const isChanged = sameCurrencyAcross && new Set(finalPrices).size > 1;
    let maxDiffPercent = 0;
    if (sameCurrencyAcross && finalPrices.length > 1) {
      const min = Math.min(...finalPrices); const max = Math.max(...finalPrices);
      maxDiffPercent = min ? ((max - min) / min) * 100 : 0;
    }
    const isLargeDifference = maxDiffPercent >= LARGE_DIFFERENCE_THRESHOLD;
    return { catalogItemId, catalogItem, perBook, isShared, isMissing, isChanged, isLargeDifference, maxDiffPercent };
  }), [itemIds, books]);

  const filteredRows = rows.filter((r) => {
    if (filter === "changed") return r.isChanged;
    if (filter === "shared") return r.isShared;
    if (filter === "missing") return r.isMissing;
    if (filter === "large") return r.isLargeDifference;
    return true;
  });

  const addBook = (id) => { if (id && !ids.includes(id) && ids.length < 3) setIds([...ids, id]); };
  const removeBook = (id) => setIds(ids.filter((x) => x !== id));

  const availableToAdd = allPriceBooks.filter((p) => !ids.includes(p._id));

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end z-50" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Compare Price Books" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border-l border-gray-800 w-full max-w-4xl h-full p-6 space-y-4 overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Compare Price Books</h2>
          <button onClick={onClose} aria-label="Close comparison"><X size={20} /></button>
        </div>

        {books.length < 2 ? (
          <p className="text-sm text-gray-500">Select at least 2 Price Books to compare.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-gray-500 font-medium pb-2 pr-4 w-40">Attribute</th>
                    {books.map((b) => (
                      <th key={b._id} className="text-left pb-2 pr-4 min-w-56">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{b.name}</span>
                          {books.length > 2 && <button onClick={() => removeBook(b._id)} aria-label={`Remove ${b.name} from comparison`} className="text-gray-500 hover:text-red-400"><X size={14} /></button>}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-t border-gray-800"><td className="py-2 pr-4 text-gray-500">Status</td>{books.map((b) => <td key={b._id} className="py-2 pr-4"><span className={`px-2 py-0.5 rounded-full text-xs border ${PB_STATUS_COLORS[getEffectiveStatus(b)]}`}>{getEffectiveStatus(b)}</span></td>)}</tr>
                  <tr className="border-t border-gray-800"><td className="py-2 pr-4 text-gray-500">Currency</td>{books.map((b) => <td key={b._id} className="py-2 pr-4">{b.currency}</td>)}</tr>
                  <tr className="border-t border-gray-800"><td className="py-2 pr-4 text-gray-500">Applicability</td>{books.map((b) => <td key={b._id} className="py-2 pr-4 text-xs">{describeApplicability(b)}</td>)}</tr>
                  <tr className="border-t border-gray-800"><td className="py-2 pr-4 text-gray-500">Effective</td>{books.map((b) => <td key={b._id} className="py-2 pr-4">{formatDate(b.effectiveDate)}</td>)}</tr>
                  <tr className="border-t border-gray-800"><td className="py-2 pr-4 text-gray-500">Expiration</td>{books.map((b) => <td key={b._id} className="py-2 pr-4">{formatDate(b.expirationDate)}</td>)}</tr>
                  <tr className="border-t border-gray-800"><td className="py-2 pr-4 text-gray-500">Priority</td>{books.map((b) => <td key={b._id} className="py-2 pr-4">{b.priority}</td>)}</tr>
                </tbody>
              </table>
            </div>

            {ids.length < 3 && availableToAdd.length > 0 && (
              <div className="flex items-center gap-2">
                <select onChange={(e) => addBook(e.target.value)} value="" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" aria-label="Add another Price Book to compare">
                  <option value="">+ Add another Price Book to compare...</option>
                  {availableToAdd.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-800">
              {[["all", "All items"], ["changed", "Changed prices"], ["shared", "Shared items"], ["missing", "Missing items"], ["large", "Large differences"]].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} className={`px-3 py-1.5 rounded-full text-xs border ${filter === key ? "bg-blue-700 border-blue-600 text-white" : "border-gray-700 text-gray-400 hover:text-white"}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-900/60 text-gray-400 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Catalog Item</th>
                    {books.map((b) => <th key={b._id} className="px-4 py-3 font-medium">{b.name}</th>)}
                    <th className="px-4 py-3 font-medium">Max % Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={books.length + 2} className="px-4 py-8 text-center text-gray-500">No items match this filter.</td></tr>
                  ) : filteredRows.map((row) => (
                    <tr key={row.catalogItemId} className="border-t border-gray-800">
                      <td className="px-4 py-3 font-medium">
                        {row.catalogItem?.name || "Item removed from catalog"}
                        {row.isMissing && <span className="ml-2 text-xs text-amber-400">missing in one</span>}
                      </td>
                      {row.perBook.map(({ book, entry, priced }) => (
                        <td key={book._id} className="px-4 py-3 text-gray-300">
                          {!entry ? <span className="text-gray-600">Not included</span> : priced?.finalPrice != null ? (
                            <span>{formatMoney(priced.finalPrice, entry.currency)} <span className="text-xs text-gray-500">(base {priced.basePrice != null ? formatMoney(priced.basePrice, entry.currency) : "—"})</span></span>
                          ) : entry.adjustmentType === "Custom Quote" ? "Custom Quote" : "Not resolvable"}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-gray-300">{row.maxDiffPercent ? formatPercent(row.maxDiffPercent) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
