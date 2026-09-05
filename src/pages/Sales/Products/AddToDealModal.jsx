import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { X, Search } from "lucide-react";
import toast from "react-hot-toast";
import { fetchDeals, updateDeal } from "../../../redux/crm/dealsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatPricingLabel } from "./catalogUtils";

// Maps a catalog billing interval onto the Deal line item's own (narrower)
// billing-frequency vocabulary — Deals don't yet support Weekly/Semiannual/
// Custom intervals, so those fall back to "One-time" rather than guessing.
const INTERVAL_TO_DEAL_FREQUENCY = { Monthly: "Monthly", Quarterly: "Quarterly", Annual: "Annually" };

export default function AddToDealModal({ item, onClose }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const deals = useSelector((s) => s.deals.items);
  const companies = useSelector((s) => s.companies.items);
  const [search, setSearch] = useState("");
  const [selectedDealId, setSelectedDealId] = useState("");
  const [quantity, setQuantity] = useState(item.minQuantity || 1);
  const [saving, setSaving] = useState(false);
  const containerRef = useFocusTrap(true, onClose);

  useEffect(() => { dispatch(fetchDeals()); dispatch(fetchCompanies()); }, [dispatch]);

  // A Deal only stores companyId, not a cached companyName — resolve it via
  // the shared Companies state rather than assuming a field that isn't there.
  const companyNameById = useMemo(() => new Map(companies.map((c) => [c._id, c.name])), [companies]);
  const dealCompanyName = (deal) => companyNameById.get(deal.companyId) || "No company";

  const openDeals = useMemo(() => deals.filter((d) => d.status === "Open"), [deals]);
  const filteredDeals = useMemo(() => {
    if (!search.trim()) return openDeals;
    const q = search.trim().toLowerCase();
    return openDeals.filter((d) => d.name.toLowerCase().includes(q) || dealCompanyName(d).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDeals, search, companyNameById]);

  const selectedDeal = deals.find((d) => d._id === selectedDealId);

  const submit = async () => {
    if (!selectedDeal) return;
    setSaving(true);
    const lineItem = {
      productId: item._id, name: item.name, description: item.shortDescription || "",
      quantity: Number(quantity) || 1, unitPrice: item.standardPrice ?? 0, discountPercent: 0,
      billingFrequency: INTERVAL_TO_DEAL_FREQUENCY[item.billingInterval] || "One-time",
    };
    const result = await dispatch(updateDeal({ id: selectedDeal._id, changes: { lineItems: [...(selectedDeal.lineItems || []), lineItem] } }));
    setSaving(false);
    if (updateDeal.fulfilled.match(result)) {
      toast.success(`Added to "${selectedDeal.name}"`);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Add to Deal" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Add to Deal</h2>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="bg-gray-800/40 rounded-lg p-3 text-sm">
          <p className="font-medium">{item.name}</p>
          <p className="text-gray-400 text-xs">{formatPricingLabel(item)}</p>
        </div>
        <p className="text-xs text-gray-500">Updates the selected Deal&apos;s line items in this session&apos;s shared frontend state. This does not create a new Deal.</p>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search open Deals..." aria-label="Search open Deals"
            className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>

        <div role="radiogroup" aria-label="Select a Deal" className="max-h-48 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800">
          {filteredDeals.length === 0 ? (
            <p className="p-4 text-sm text-gray-500 text-center">No open Deals match your search.</p>
          ) : (
            filteredDeals.map((d) => (
              <label key={d._id} className={`flex items-center justify-between gap-2 p-2.5 text-sm cursor-pointer ${selectedDealId === d._id ? "bg-blue-900/20" : "hover:bg-gray-800/40"}`}>
                <span className="flex items-center gap-2 min-w-0">
                  <input type="radio" name="deal-pick" checked={selectedDealId === d._id} onChange={() => setSelectedDealId(d._id)} />
                  <span className="truncate">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-gray-500"> — {dealCompanyName(d)}</span>
                  </span>
                </span>
                <span className="text-xs text-gray-400 shrink-0">{formatMoney(d.value, d.currency)}</span>
              </label>
            ))
          )}
        </div>

        {selectedDeal && (
          <div>
            <label htmlFor="add-to-deal-qty" className="block text-sm mb-1 text-gray-300">Quantity</label>
            <input id="add-to-deal-qty" type="number" min={item.minQuantity || 1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-gray-800">
          <button type="button" onClick={() => navigate("/crm/deals")} className="text-xs text-blue-400 hover:underline">View all Deals</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
            <button onClick={submit} disabled={!selectedDeal || saving} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
              {saving ? "Adding..." : "Add to Deal"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
