import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { X, AlertTriangle, Search } from "lucide-react";
import { computeQuoteTotals, computeLineTotal, getEffectiveStatus as getQuoteEffectiveStatus } from "../../../Helpers/mockQuoteData";
import { ordersForQuote } from "../../../Helpers/mockOrderData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatDate } from "./orderUtils";

// Selecting a Quote here never creates an Order directly — it hands the
// chosen Quote id to OrderBuilder (mode="fromQuote"), which still requires
// full review across every step before anything is saved.
export default function CreateFromQuoteDialog({ preselectedQuoteId, onClose, onUseQuote }) {
  const allQuotes = useSelector((s) => s.quotes.items);
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const priceBooksList = useSelector((s) => s.priceBooks.items);
  const containerRef = useFocusTrap(true, onClose);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(preselectedQuoteId || "");
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

  const acceptedQuotes = useMemo(() => allQuotes.filter((q) => getQuoteEffectiveStatus(q) === "Preview Accepted"), [allQuotes]);
  const filteredAccepted = useMemo(() => {
    if (!search.trim()) return acceptedQuotes;
    const q = search.trim().toLowerCase();
    return acceptedQuotes.filter((quote) => quote.quoteNumber.toLowerCase().includes(q) || quote.title.toLowerCase().includes(q));
  }, [acceptedQuotes, search]);

  const selectedQuote = allQuotes.find((q) => q._id === selectedId);
  const selectedEffStatus = selectedQuote ? getQuoteEffectiveStatus(selectedQuote) : null;
  const needsOverride = selectedQuote && selectedEffStatus !== "Preview Accepted";
  const existingOrders = selectedQuote ? ordersForQuote(selectedQuote._id) : [];
  const needsDuplicateAck = existingOrders.length > 0;

  const canProceed = !!selectedQuote && (!needsOverride || overrideAcknowledged) && (!needsDuplicateAck || duplicateAcknowledged);

  const company = selectedQuote ? companies.find((c) => c._id === selectedQuote.companyId) : null;
  const contact = selectedQuote ? allContacts.find((c) => c._id === selectedQuote.primaryContactId) : null;
  const deal = selectedQuote ? deals.find((d) => d._id === selectedQuote.dealId) : null;
  const priceBook = selectedQuote ? priceBooksList.find((p) => p._id === selectedQuote.priceBookId) : null;
  const totals = selectedQuote ? computeQuoteTotals(selectedQuote) : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Create Order from Quote" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto text-white">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Create Order from Quote</h2>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <p className="text-xs text-gray-500">Frontend Quote acceptance is simulated in this session — selecting a Quote below copies its commercial information into a new Order draft snapshot.</p>

        {!preselectedQuoteId && (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accepted quotes..." aria-label="Search accepted quotes" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm" />
            </div>
            <div role="radiogroup" aria-label="Select a Quote" className="max-h-40 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800">
              {filteredAccepted.length === 0 ? (
                <p className="p-3 text-sm text-gray-500">No accepted quotes match your search.</p>
              ) : filteredAccepted.map((q) => (
                <label key={q._id} className={`flex items-center justify-between gap-2 p-2.5 text-sm cursor-pointer ${selectedId === q._id ? "bg-blue-900/20" : "hover:bg-gray-800/40"}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="quote-pick" checked={selectedId === q._id} onChange={() => { setSelectedId(q._id); setOverrideAcknowledged(false); setDuplicateAcknowledged(false); }} />
                    <span>{q.quoteNumber} (v{q.version}) — {q.title}</span>
                  </span>
                  <span className="text-xs text-gray-400">{formatMoney(computeQuoteTotals(q).grandTotal, q.currency)}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {selectedQuote && (
          <div className="border border-gray-800 rounded-xl p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{selectedQuote.quoteNumber} (v{selectedQuote.version}) — {selectedQuote.title}</p>
              <span className="text-xs text-gray-400">{selectedEffStatus}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-300">
              <p><span className="text-gray-500">Company:</span> {company?.name || "—"}</p>
              <p><span className="text-gray-500">Contact:</span> {contact?.name || "—"}</p>
              <p><span className="text-gray-500">Deal:</span> {deal?.name || "None"}</p>
              <p><span className="text-gray-500">Currency:</span> {selectedQuote.currency}</p>
              <p><span className="text-gray-500">Price Book:</span> {priceBook?.name || "None"}</p>
              <p><span className="text-gray-500">Line items:</span> {selectedQuote.lineItems?.length || 0}</p>
            </div>
            <div className="bg-gray-800/40 rounded-lg p-2 text-xs space-y-1">
              {(selectedQuote.lineItems || []).slice(0, 5).map((l) => (
                <div key={l._id} className="flex justify-between"><span>{l.name} × {l.quantity}</span><span>{formatMoney(computeLineTotal(l), selectedQuote.currency)}</span></div>
              ))}
              <div className="flex justify-between pt-1 border-t border-gray-700 text-gray-400"><span>One-time / Recurring</span><span>{formatMoney(totals.oneTimeTotal, selectedQuote.currency)} / {formatMoney(totals.monthlyRecurringTotal + totals.annualRecurringTotal + totals.otherRecurringTotal, selectedQuote.currency)}</span></div>
            </div>
            <p className="text-xs text-gray-400">Terms: {selectedQuote.paymentTerms} · {selectedQuote.billingSchedule} · Valid until {selectedQuote.validUntilDate ? formatDate(selectedQuote.validUntilDate) : "—"}</p>
            {selectedQuote.customerResponse?.type === "Accepted" && (
              <p className="text-xs text-emerald-300">Acceptance preview: {selectedQuote.customerResponse.customerName} ({selectedQuote.customerResponse.jobTitle}), {formatDate(selectedQuote.customerResponse.at)}</p>
            )}

            {needsOverride && (
              <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3 text-xs text-red-200 space-y-2">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> This quote is {selectedEffStatus.replace(/^Preview /, "")}, not Accepted.</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={overrideAcknowledged} onChange={(e) => setOverrideAcknowledged(e.target.checked)} /> I understand and want to create an Order from this Quote anyway (explicit override).</label>
              </div>
            )}
            {needsDuplicateAck && (
              <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 space-y-2">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> {existingOrders.length} Order(s) already exist for this Quote: {existingOrders.map((o) => o.orderNumber).join(", ")}.</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={duplicateAcknowledged} onChange={(e) => setDuplicateAcknowledged(e.target.checked)} /> Create another Order anyway (explicit override).</label>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button disabled={!canProceed} onClick={() => onUseQuote(selectedQuote._id)} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Use This Quote</button>
        </div>
      </div>
    </div>
  );
}
