import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { X, AlertTriangle, Search } from "lucide-react";
import { getEffectiveStatus as getQuoteEffectiveStatus, computeQuoteTotals } from "../../../Helpers/mockQuoteData";
import { computeOrderTotals, getEffectiveStatus as getOrderEffectiveStatus } from "../../../Helpers/mockOrderData";
import { contractsForQuote, contractsForOrder, contractsForDeal } from "../../../Helpers/mockContractData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney } from "./contractUtils";

const SOURCE_CONFIG = {
  quote: {
    title: "Prepare Contract from Quote",
    intro: "Selecting a Quote below copies its commercial information into a new Contract draft snapshot.",
    searchPlaceholder: "Search accepted quotes...",
    isEligible: (q) => getQuoteEffectiveStatus(q) === "Preview Accepted",
    label: (q) => `${q.quoteNumber} (v${q.version}) — ${q.title}`,
    statusOf: (q) => getQuoteEffectiveStatus(q),
    existingFor: (q) => contractsForQuote(q._id),
    total: (q) => computeQuoteTotals(q).grandTotal,
  },
  order: {
    title: "Generate Contract from Order",
    intro: "Selecting an Order below copies its commercial information into a new Contract draft snapshot.",
    searchPlaceholder: "Search confirmed Orders...",
    isEligible: (o) => ["Confirmed", "Processing", "Partially Fulfilled", "Fulfilled", "Completed"].includes(getOrderEffectiveStatus(o)),
    label: (o) => `${o.orderNumber} — ${o.orderType}`,
    statusOf: (o) => getOrderEffectiveStatus(o),
    existingFor: (o) => contractsForOrder(o._id),
    total: (o) => computeOrderTotals(o).grandTotal,
  },
  deal: {
    title: "Generate Contract from Won Deal",
    intro: "Selecting a Won Deal below starts a new Contract linked to that Deal — line items are added manually in the builder.",
    searchPlaceholder: "Search Won Deals...",
    isEligible: (d) => d.status === "Won",
    label: (d) => d.name,
    statusOf: (d) => d.status,
    existingFor: (d) => contractsForDeal(d._id),
    total: (d) => d.value || 0,
  },
};

export default function PrepareContractDialog({ sourceType, preselectedId, onClose, onUseSource }) {
  const config = SOURCE_CONFIG[sourceType];
  const allQuotes = useSelector((s) => s.quotes.items);
  const allOrders = useSelector((s) => s.orders.items);
  const allDeals = useSelector((s) => s.deals.items);
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const containerRef = useFocusTrap(true, onClose);

  const sourceList = sourceType === "quote" ? allQuotes : sourceType === "order" ? allOrders : allDeals;

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(preselectedId || "");
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

  const eligible = useMemo(() => sourceList.filter(config.isEligible), [sourceList, config]);
  const filtered = useMemo(() => {
    if (!search.trim()) return eligible;
    const q = search.trim().toLowerCase();
    return eligible.filter((item) => config.label(item).toLowerCase().includes(q));
  }, [eligible, search, config]);

  const selected = sourceList.find((item) => item._id === selectedId);
  const selectedStatus = selected ? config.statusOf(selected) : null;
  const needsOverride = selected && !config.isEligible(selected);
  const existing = selected ? config.existingFor(selected) : [];
  const needsDuplicateAck = existing.length > 0;

  const canProceed = !!selected && (!needsOverride || overrideAcknowledged) && (!needsDuplicateAck || duplicateAcknowledged);

  const company = selected ? companies.find((c) => c._id === selected.companyId) : null;
  const contact = selected ? allContacts.find((c) => c._id === (selected.contactId || selected.primaryContactId)) : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={config.title} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto text-white">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">{config.title}</h2>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <p className="text-xs text-gray-500">{config.intro}</p>

        {!preselectedId && (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={config.searchPlaceholder} aria-label={config.searchPlaceholder} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm" />
            </div>
            <div role="radiogroup" aria-label={`Select a ${sourceType}`} className="max-h-40 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800">
              {filtered.length === 0 ? (
                <p className="p-3 text-sm text-gray-500">No eligible {sourceType}s match your search.</p>
              ) : filtered.map((item) => (
                <label key={item._id} className={`flex items-center justify-between gap-2 p-2.5 text-sm cursor-pointer ${selectedId === item._id ? "bg-blue-900/20" : "hover:bg-gray-800/40"}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="source-pick" checked={selectedId === item._id} onChange={() => { setSelectedId(item._id); setOverrideAcknowledged(false); setDuplicateAcknowledged(false); }} />
                    <span>{config.label(item)}</span>
                  </span>
                  <span className="text-xs text-gray-400">{formatMoney(config.total(item), item.currency || "USD")}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {selected && (
          <div className="border border-gray-800 rounded-xl p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{config.label(selected)}</p>
              <span className="text-xs text-gray-400">{selectedStatus}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-300">
              <p><span className="text-gray-500">Company:</span> {company?.name || "—"}</p>
              <p><span className="text-gray-500">Contact:</span> {contact?.name || "—"}</p>
              <p><span className="text-gray-500">Currency:</span> {selected.currency || "USD"}</p>
              <p><span className="text-gray-500">Value:</span> {formatMoney(config.total(selected), selected.currency || "USD")}</p>
            </div>

            {needsOverride && (
              <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3 text-xs text-red-200 space-y-2">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> This {sourceType} is {String(selectedStatus)}, which isn't the expected status for preparing a Contract.</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={overrideAcknowledged} onChange={(e) => setOverrideAcknowledged(e.target.checked)} /> I understand and want to prepare a Contract anyway (explicit override).</label>
              </div>
            )}
            {needsDuplicateAck && (
              <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 space-y-2">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> {existing.length} Contract(s) already exist for this {sourceType}: {existing.map((c) => c.contractNumber).join(", ")}.</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={duplicateAcknowledged} onChange={(e) => setDuplicateAcknowledged(e.target.checked)} /> Prepare another Contract anyway (explicit override).</label>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button disabled={!canProceed} onClick={() => onUseSource(selected._id)} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Use This {sourceType === "quote" ? "Quote" : sourceType === "order" ? "Order" : "Deal"}</button>
        </div>
      </div>
    </div>
  );
}
