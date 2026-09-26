import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Pencil, Copy, Scale, Archive, RotateCcw, MoreHorizontal, ArrowLeft, PlusCircle,
  FileText, Layers, AlertTriangle, Shield, TrendingUp, Search,
} from "lucide-react";
import { fetchPriceBook, updatePriceBook, archivePriceBook, restorePriceBook } from "../../../redux/sales/priceBooksSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchProducts } from "../../../redux/sales/productsSlice";
import {
  getEffectiveStatus, specificityRank, SPECIFICITY_LABELS, describeApplicability, computeEntryFinalPrice,
  validateQuantityTiers, findConflicts, dealsUsingPriceBook, resolvePrice, computeActivationWarnings,
  SETTABLE_STATUSES, ADJUSTMENT_TYPES, MARKETS, CUSTOMER_SEGMENTS, SALES_CHANNELS, PRICE_BOOK_DEAL_TYPES,
} from "../../../Helpers/mockPriceBookData";
import { findCatalogItem, BILLING_INTERVALS } from "../../../Helpers/mockCatalogData";
import { quotes } from "../../../Helpers/mockSalesData";
import { getEffectiveStatus as getQuoteEffectiveStatus } from "../../../Helpers/mockQuoteData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatDate, formatDateTime, formatPercent, PB_STATUS_COLORS } from "./priceBookUtils";
import PriceBookFormModal from "./PriceBookFormModal";
import CompareDrawer from "./CompareDrawer";

const TABS = ["overview", "pricing", "applicability", "tiers", "preview", "deals", "quotes", "history", "audit"];
// The server keeps no change history or audit log for price books yet, so those tabs are hidden there.
const VISIBLE_TABS = BACKEND_CRM_SALES_MODE_ENABLED ? TABS.filter((t) => !["history", "audit"].includes(t)) : TABS;
const TAB_LABELS = {
  overview: "Overview", pricing: "Catalog Pricing", applicability: "Applicability", tiers: "Quantity Tiers",
  preview: "Price Preview", deals: "Related Deals", quotes: "Related Quotes", history: "Change History", audit: "Audit",
};

export default function PriceBookDetail() {
  const { priceBookId } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const pb = useSelector((s) => s.priceBooks.current);
  const currentNotFound = useSelector((s) => s.priceBooks.currentNotFound);
  const allPriceBooks = useSelector((s) => s.priceBooks.items);
  const companies = useSelector((s) => s.companies.items);

  const [tab, setTab] = useState("overview");
  const [formOpen, setFormOpen] = useState(null); // { mode, initialStep }
  const [showArchive, setShowArchive] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);

  useEffect(() => {
    dispatch(fetchPriceBook(priceBookId));
    dispatch(fetchDeals());
    dispatch(fetchCompanies());
    dispatch(fetchProducts());
  }, [dispatch, priceBookId]);

  if (currentNotFound) {
    return (
      <div className="p-6 text-white">
        <button onClick={() => navigate("/sales/price-books")} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4"><ArrowLeft size={15} /> Back to Price Books</button>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-400">
          <p className="mb-1">This Price Book couldn&apos;t be found.</p>
          <p className="text-sm text-gray-500">It may have been part of an earlier session — this in-memory data resets on a full page reload.</p>
        </div>
      </div>
    );
  }
  if (!pb) {
    return (
      <div className="p-6 text-white">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-40 bg-gray-800 rounded" />
          <div className="h-8 w-72 bg-gray-800 rounded" />
          <div className="h-32 bg-gray-900/40 border border-gray-800 rounded-xl" />
        </div>
      </div>
    );
  }

  const effStatus = getEffectiveStatus(pb);
  const conflicts = findConflicts(pb, allPriceBooks);
  const affectedDeals = dealsUsingPriceBook(pb._id);

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/sales/dashboard" className="hover:text-gray-300">Sales</Link> / <Link to="/sales/price-books" className="hover:text-gray-300">Price Books</Link> / <span className="text-gray-300">{pb.name}</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-2xl font-bold">{pb.name}</h1>
            <span className={`px-2 py-1 rounded-full text-xs border ${PB_STATUS_COLORS[effStatus]}`}>{effStatus}</span>
            {conflicts.length > 0 && <span title={conflicts.map((c) => c.resolution).join(" | ")} className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle size={13} /> {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}</span>}
          </div>
          <p className="text-sm text-gray-400">
            {pb.code} · {pb.currency} · Priority {pb.priority} · {SPECIFICITY_LABELS[specificityRank(pb)]} · Owner: {pb.ownerName || "Unassigned"} · Updated {formatDate(pb.updatedAt)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{formatDate(pb.effectiveDate)} – {pb.expirationDate ? formatDate(pb.expirationDate) : "No expiration"}</p>
        </div>
        <div data-tour="pricebook-actions" className="flex gap-2 flex-wrap">
          <button onClick={() => setFormOpen({ mode: "edit", initialStep: 0 })} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium"><Pencil size={15} /> Edit</button>
          <button onClick={() => setFormOpen({ mode: "edit", initialStep: 3 })} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><PlusCircle size={15} /> Add Catalog Items</button>
          <button onClick={() => setTab("preview")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Search size={15} /> Preview Price</button>
          <div className="relative">
            <button onClick={() => setRowMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={rowMenuOpen} aria-label="More actions" className="p-2 rounded-lg border border-gray-700 hover:bg-gray-800"><MoreHorizontal size={16} /></button>
            {rowMenuOpen && (
              <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-48 shadow-xl">
                <button role="menuitem" onClick={() => { setFormOpen({ mode: "duplicate" }); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><Copy size={13} /> Duplicate</button>
                <button role="menuitem" onClick={() => { setShowCompare(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><Scale size={13} /> Compare</button>
                <button role="menuitem" onClick={() => { setShowStatus(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Change Status</button>
                {pb.status === "Archived" ? (
                  <button role="menuitem" onClick={() => { dispatch(restorePriceBook(pb._id)); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><RotateCcw size={13} /> Restore</button>
                ) : (
                  <button role="menuitem" onClick={() => { setShowArchive(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5 text-red-300"><Archive size={13} /> Archive</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <nav data-tour="pricebook-tabs" className="flex gap-1 border-b border-gray-800 mb-4 overflow-x-auto" aria-label="Price Book detail tabs">
        {VISIBLE_TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}
            className={`px-3 py-2 text-sm whitespace-nowrap rounded-t-lg ${tab === t ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab pb={pb} conflicts={conflicts} />}
      {tab === "pricing" && <PricingTab pb={pb} onEditPricing={() => setFormOpen({ mode: "edit", initialStep: 4 })} />}
      {tab === "applicability" && <ApplicabilityTab pb={pb} companies={companies} onEdit={() => setFormOpen({ mode: "edit", initialStep: 1 })} />}
      {tab === "tiers" && <QuantityTiersTab pb={pb} />}
      {tab === "preview" && <PricePreviewTab pb={pb} allPriceBooks={allPriceBooks} companies={companies} />}
      {tab === "deals" && <RelatedDealsTab companies={companies} affectedDeals={affectedDeals} />}
      {tab === "quotes" && <QuotesTab pb={pb} companies={companies} />}
      {tab === "history" && <HistoryTab activity={pb.activity || []} />}
      {tab === "audit" && <AuditTab auditLog={pb.auditLog || []} />}

      {formOpen && (
        <PriceBookFormModal
          mode={formOpen.mode}
          priceBook={pb}
          initialStep={formOpen.initialStep || 0}
          onClose={() => setFormOpen(null)}
          onSaved={() => dispatch(fetchPriceBook(priceBookId))}
        />
      )}
      {showCompare && <CompareDrawer priceBookIds={[pb._id]} onClose={() => setShowCompare(false)} />}
      {showArchive && <ArchiveDetailDialog pb={pb} affectedDeals={affectedDeals} onClose={() => setShowArchive(false)} onDone={() => { setShowArchive(false); dispatch(fetchPriceBook(priceBookId)); }} />}
      {showStatus && <StatusDetailDialog pb={pb} allPriceBooks={allPriceBooks} affectedDeals={affectedDeals} onClose={() => setShowStatus(false)} onDone={() => { setShowStatus(false); dispatch(fetchPriceBook(priceBookId)); }} />}
    </div>
  );
}

function EmptyPanel({ icon, text }) {
  const Icon = icon;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
      <Icon size={22} className="mx-auto mb-2 text-gray-600" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-200">{value ?? "—"}</dd>
    </div>
  );
}

function OverviewTab({ pb, conflicts }) {
  const missing = (pb.items || []).filter((entry) => {
    if (entry.adjustmentType === "Custom Quote") return false;
    const c = findCatalogItem(entry.catalogItemId);
    if (!c) return true;
    return computeEntryFinalPrice(entry, c, entry.minQuantity || 1)?.finalPrice == null;
  });
  const typeCounts = (pb.items || []).reduce((acc, e) => { acc[e.adjustmentType] = (acc[e.adjustmentType] || 0) + 1; return acc; }, {});
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Description</h3>
          <p className="text-sm text-gray-400 whitespace-pre-wrap">{pb.description || "No description provided."}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Applicability summary</h3>
          <p className="text-sm text-gray-300">{describeApplicability(pb)}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Pricing summary</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Catalog items" value={(pb.items || []).length} />
            <Field label="Missing prices" value={missing.length} />
            {ADJUSTMENT_TYPES.filter((t) => typeCounts[t]).map((t) => <Field key={t} label={t} value={typeCounts[t]} />)}
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Conflict summary</h3>
          {conflicts.length === 0 ? <p className="text-sm text-gray-500">No conflicts detected with other Price Books.</p> : (
            <ul className="text-sm text-gray-300 space-y-1">
              {conflicts.map((c) => <li key={c.priceBookId} className={c.unresolved ? "text-red-300" : ""}>{c.priceBookName}: {c.resolution}</li>)}
            </ul>
          )}
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Schedule</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Effective" value={formatDate(pb.effectiveDate)} />
            <Field label="Expiration" value={pb.expirationDate ? formatDate(pb.expirationDate) : "None"} />
            <Field label="Currency" value={pb.currency} />
            <Field label="Priority" value={pb.priority} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Owner &amp; tags</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Owner" value={pb.ownerName || "Unassigned"} />
            <Field label="Tags" value={(pb.tags || []).join(", ") || "—"} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Record</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Created" value={formatDateTime(pb.createdAt)} />
            <Field label="Updated" value={formatDateTime(pb.updatedAt)} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function PricingTab({ pb, onEditPricing }) {
  const dispatch = useDispatch();
  const [selected, setSelected] = useState(new Set());
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [bulkAdjust, setBulkAdjust] = useState(null);
  const items = pb.items || [];

  const toggleSelect = (id) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const toggleEnabled = (catalogItemId, enabled) => {
    const nextItems = items.map((i) => (i.catalogItemId === catalogItemId ? { ...i, enabled } : i));
    dispatch(updatePriceBook({ id: pb._id, changes: { items: nextItems } }));
  };
  const removeItem = (catalogItemId) => {
    const nextItems = items.filter((i) => i.catalogItemId !== catalogItemId);
    dispatch(updatePriceBook({ id: pb._id, changes: { items: nextItems } }));
    setConfirmRemove(null);
  };

  if (items.length === 0) return <EmptyPanel icon={Layers} text="No catalog items in this Price Book yet." />;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <p className="text-sm text-gray-400">{items.length} item{items.length === 1 ? "" : "s"}</p>
        <div className="flex gap-2">
          {selected.size > 0 && <button onClick={() => setBulkAdjust(Array.from(selected))} className="text-sm text-blue-400 hover:underline">Apply Adjustment to Selected ({selected.size})</button>}
          <button onClick={onEditPricing} className="text-sm text-blue-400 hover:underline">Edit Pricing</button>
        </div>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
            <th className="px-4 py-3 w-8"></th><th className="px-4 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Category</th><th className="px-4 py-3 font-medium">Base Price</th><th className="px-4 py-3 font-medium">Adjustment</th>
            <th className="px-4 py-3 font-medium">Final Price</th><th className="px-4 py-3 font-medium">Difference</th><th className="px-4 py-3 font-medium">Qty Range</th>
            <th className="px-4 py-3 font-medium">Billing</th><th className="px-4 py-3 font-medium">Enabled</th><th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr></thead>
          <tbody>
            {items.map((entry) => {
              const c = findCatalogItem(entry.catalogItemId);
              if (!c) return (
                <tr key={entry.catalogItemId} className="border-t border-gray-800 text-gray-500">
                  <td className="px-4 py-3"></td><td className="px-4 py-3" colSpan={10}>Catalog item removed</td>
                </tr>
              );
              const priced = computeEntryFinalPrice(entry, c, entry.minQuantity || 1);
              return (
                <tr key={entry.catalogItemId} className="border-t border-gray-800">
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.has(entry.catalogItemId)} onChange={() => toggleSelect(entry.catalogItemId)} aria-label={`Select ${c.name}`} /></td>
                  <td className="px-4 py-3 font-medium"><Link to={`/sales/products/${c._id}`} className="text-blue-400 hover:underline">{c.name}</Link></td>
                  <td className="px-4 py-3 text-gray-300">{c.type}</td>
                  <td className="px-4 py-3 text-gray-300">{c.category}</td>
                  <td className="px-4 py-3 text-gray-300">{priced.basePrice != null ? formatMoney(priced.basePrice, c.currency) : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{entry.adjustmentType}</td>
                  <td className="px-4 py-3 text-gray-300">{priced.finalPrice != null ? formatMoney(priced.finalPrice, entry.currency) : entry.adjustmentType === "Custom Quote" ? "Custom Quote" : "Not resolvable"}</td>
                  <td className="px-4 py-3 text-gray-300">{priced.sameCurrency && priced.percentDifference != null ? formatPercent(priced.percentDifference) : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{entry.minQuantity}{entry.maxQuantity ? `–${entry.maxQuantity}` : "+"}</td>
                  <td className="px-4 py-3 text-gray-300">{entry.billingInterval || "—"}</td>
                  <td className="px-4 py-3"><input type="checkbox" checked={entry.enabled !== false} onChange={(e) => toggleEnabled(entry.catalogItemId, e.target.checked)} aria-label={`Enable ${c.name}`} /></td>
                  <td className="px-4 py-3 text-right"><button onClick={() => setConfirmRemove(entry.catalogItemId)} className="text-red-400 hover:text-red-300 text-xs">Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title="Remove catalog item"
          text={`Remove "${findCatalogItem(confirmRemove)?.name}" from this Price Book? This only affects future price resolution — existing Deal line items keep their current values.`}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => removeItem(confirmRemove)}
        />
      )}
      {bulkAdjust && (
        <BulkAdjustDialog
          pb={pb} catalogItemIds={bulkAdjust}
          onClose={() => setBulkAdjust(null)}
          onApplied={() => { setBulkAdjust(null); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ title, text, onCancel, onConfirm }) {
  const containerRef = useFocusTrap(true, onCancel);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold">{title}</h3>
        <p className="text-sm text-gray-400">{text}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Confirm</button>
        </div>
      </div>
    </div>
  );
}

function BulkAdjustDialog({ pb, catalogItemIds, onClose, onApplied }) {
  const dispatch = useDispatch();
  const containerRef = useFocusTrap(true, onClose);
  const [adjustmentType, setAdjustmentType] = useState("Percentage Decrease");
  const [value, setValue] = useState(10);

  const targets = pb.items.filter((i) => catalogItemIds.includes(i.catalogItemId));
  const preview = targets.map((entry) => {
    const c = findCatalogItem(entry.catalogItemId);
    const before = computeEntryFinalPrice(entry, c, entry.minQuantity || 1);
    const hypothetical = { ...entry, adjustmentType, adjustmentValue: value };
    const after = c ? computeEntryFinalPrice(hypothetical, c, entry.minQuantity || 1) : null;
    return { c, before, after };
  });

  const apply = () => {
    const nextItems = pb.items.map((i) => (catalogItemIds.includes(i.catalogItemId) ? { ...i, adjustmentType, adjustmentValue: value } : i));
    dispatch(updatePriceBook({ id: pb._id, changes: { items: nextItems } }));
    onApplied();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Apply adjustment to selected items" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <h3 className="text-base font-bold">Apply Adjustment to {catalogItemIds.length} Item(s)</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <select value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value)} className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {ADJUSTMENT_TYPES.filter((t) => t !== "Quantity Tier" && t !== "Custom Quote").map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="border border-gray-800 rounded-lg divide-y divide-gray-800 text-sm">
          {preview.map(({ c, before, after }) => (
            <div key={c?._id} className="flex justify-between items-center px-3 py-2">
              <span>{c?.name}</span>
              <span className="text-gray-400">{before.finalPrice != null ? formatMoney(before.finalPrice, c.currency) : "—"} → <span className="text-white font-medium">{after?.finalPrice != null ? formatMoney(after.finalPrice, c.currency) : "Not resolvable"}</span></span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">Preview of the price impact before applying — nothing is saved until you confirm.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button onClick={apply} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Apply</button>
        </div>
      </div>
    </div>
  );
}

function ApplicabilityTab({ pb, companies, onEdit }) {
  const companyNameById = new Map(companies.map((c) => [c._id, c.name]));
  return (
    <div className="space-y-4">
      <div className="bg-blue-900/15 border border-blue-800/30 rounded-xl p-4">
        <p className="text-sm text-blue-100">{describeApplicability(pb)}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Scope</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Market" value={pb.market || "Global"} />
            <Field label="Customer Segment" value={pb.customerSegment || "Any"} />
            <Field label="Sales Channel" value={pb.salesChannel || "Any"} />
            <Field label="Specific Companies" value={(pb.companyIds || []).map((id) => companyNameById.get(id)).filter(Boolean).join(", ") || "None (broad)"} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Deal &amp; contract scope</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Product Categories" value={(pb.categories || []).join(", ") || "All"} />
            <Field label="Deal Types" value={(pb.dealTypes || []).join(", ") || "All"} />
            <Field label="Contract Types" value={(pb.contractTypes || []).join(", ") || "All"} />
          </dl>
        </div>
      </div>
      <button onClick={onEdit} className="text-sm text-blue-400 hover:underline">Edit Applicability</button>
    </div>
  );
}

function QuantityTiersTab({ pb }) {
  const tierEntries = (pb.items || []).filter((e) => e.adjustmentType === "Quantity Tier");
  if (tierEntries.length === 0) return <EmptyPanel icon={Layers} text="No quantity-tiered items in this Price Book." />;
  return (
    <div className="space-y-4">
      {tierEntries.map((entry) => {
        const c = findCatalogItem(entry.catalogItemId);
        if (!c) return null;
        const tierErrors = validateQuantityTiers(entry.tiers);
        return (
          <div key={entry.catalogItemId} className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
              <span className="font-medium text-sm">{c.name}</span>
              <span className="text-xs text-gray-500">Effective {formatDate(entry.effectiveDate) !== "—" ? formatDate(entry.effectiveDate) : "immediately"}</span>
            </div>
            {tierErrors.length > 0 && <p className="px-4 py-2 text-xs text-red-400 bg-red-900/10">{tierErrors.join("; ")}</p>}
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
                <th className="px-4 py-2 font-medium">Minimum Qty</th><th className="px-4 py-2 font-medium">Maximum Qty</th>
                <th className="px-4 py-2 font-medium">Unit Price</th><th className="px-4 py-2 font-medium">Discount from Base</th>
              </tr></thead>
              <tbody>
                {entry.tiers.map((t, idx) => {
                  const discount = c.standardPrice ? ((c.standardPrice - t.unitPrice) / c.standardPrice) * 100 : null;
                  return (
                    <tr key={idx} className="border-t border-gray-800">
                      <td className="px-4 py-2 text-gray-300">{t.minQty}</td>
                      <td className="px-4 py-2 text-gray-300">{t.maxQty ?? "No maximum"}</td>
                      <td className="px-4 py-2 text-gray-300">{formatMoney(t.unitPrice, entry.currency)}</td>
                      <td className="px-4 py-2 text-gray-300">{discount != null ? formatPercent(-discount) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function PricePreviewTab({ pb, allPriceBooks, companies }) {
  const catalogItemsForPreview = useSelector((s) => s.products.items);
  const [context, setContext] = useState({
    date: new Date().toISOString().slice(0, 10), companyId: "", customerSegment: "", market: pb.market !== "Global" ? pb.market : "",
    currency: pb.currency, salesChannel: "", dealType: "", catalogItemId: pb.items?.[0]?.catalogItemId || "", quantity: 1, billingInterval: "",
  });
  const set = (field) => (e) => setContext((c) => ({ ...c, [field]: e.target.value }));

  const result = useMemo(() => resolvePrice({
    date: new Date(context.date).toISOString(), companyId: context.companyId || undefined, customerSegment: context.customerSegment || undefined,
    market: context.market || undefined, currency: context.currency, salesChannel: context.salesChannel || undefined,
    dealType: context.dealType || undefined, catalogItemId: context.catalogItemId, quantity: Number(context.quantity) || 1,
    billingInterval: context.billingInterval || undefined,
  }, { allPriceBooks, allCatalogItems: catalogItemsForPreview.length ? catalogItemsForPreview : undefined }), [context, allPriceBooks, catalogItemsForPreview]);

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold">Pricing context</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="block text-xs mb-1 text-gray-400">Date</label><input type="date" value={context.date} onChange={set("date")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs mb-1 text-gray-400">Company</label>
            <select value={context.companyId} onChange={set("companyId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Any</option>
              {companies.slice(0, 200).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="block text-xs mb-1 text-gray-400">Customer Segment</label>
            <select value={context.customerSegment} onChange={set("customerSegment")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Any</option>{CUSTOMER_SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label className="block text-xs mb-1 text-gray-400">Market</label>
            <select value={context.market} onChange={set("market")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Any</option>{MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div><label className="block text-xs mb-1 text-gray-400">Currency</label>
            <select value={context.currency} onChange={set("currency")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {["USD", "EUR", "GBP", "INR", "IDR"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="block text-xs mb-1 text-gray-400">Sales Channel</label>
            <select value={context.salesChannel} onChange={set("salesChannel")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Any</option>{SALES_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="block text-xs mb-1 text-gray-400">Deal Type</label>
            <select value={context.dealType} onChange={set("dealType")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Any</option>{PRICE_BOOK_DEAL_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div><label className="block text-xs mb-1 text-gray-400">Quantity</label><input type="number" min="1" value={context.quantity} onChange={set("quantity")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs mb-1 text-gray-400">Billing Interval</label>
            <select value={context.billingInterval} onChange={set("billingInterval")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Any</option>{BILLING_INTERVALS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><label className="block text-xs mb-1 text-gray-400">Catalog Item</label>
            <select value={context.catalogItemId} onChange={set("catalogItemId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {(catalogItemsForPreview.length ? catalogItemsForPreview : []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold">Resolved price</h3>
          {result.winner ? (
            <>
              <p className="text-2xl font-bold">{formatMoney(result.winner.finalPrice, result.winner.entry.currency)}</p>
              <p className="text-sm text-gray-300">via <Link to={`/sales/price-books/${result.winner.priceBook._id}`} className="text-blue-400 hover:underline">{result.winner.priceBook.name}</Link></p>
              <p className="text-xs text-gray-500">Base: {result.winner.basePrice != null ? formatMoney(result.winner.basePrice, result.winner.entry.currency) : "—"} · {result.reason}</p>
            </>
          ) : result.fallback ? (
            <>
              <p className="text-2xl font-bold">{result.fallback.finalPrice != null ? formatMoney(result.fallback.finalPrice, result.fallback.currency) : "—"}</p>
              <p className="text-sm text-gray-400">{result.reason}</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">{result.reason}</p>
          )}
          {result.tied && (
            <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3 text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> Unresolved conflict — multiple Price Books tie on specificity and priority.
            </div>
          )}
          <p className="text-[11px] text-gray-500 pt-1 border-t border-gray-800">An estimate from the price book rules. The final price is set on the quote.</p>
        </div>

        {result.matches?.length > 0 && (
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-left"><tr><th className="px-4 py-2 font-medium">Matching Price Book</th><th className="px-4 py-2 font-medium">Specificity</th><th className="px-4 py-2 font-medium">Priority</th><th className="px-4 py-2 font-medium">Price</th></tr></thead>
              <tbody>
                {result.matches.map((m) => (
                  <tr key={m.priceBook._id} className={`border-t border-gray-800 ${m === result.winner ? "bg-blue-900/10" : ""}`}>
                    <td className="px-4 py-2"><Link to={`/sales/price-books/${m.priceBook._id}`} className="text-blue-400 hover:underline">{m.priceBook.name}</Link>{m === result.winner && <span className="ml-2 text-xs text-emerald-400">Selected</span>}</td>
                    <td className="px-4 py-2 text-gray-300">{m.specificity}</td>
                    <td className="px-4 py-2 text-gray-300">{m.priceBook.priority}</td>
                    <td className="px-4 py-2 text-gray-300">{m.finalPrice != null ? formatMoney(m.finalPrice, m.entry.currency) : "—"}</td>
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

function RelatedDealsTab({ companies, affectedDeals }) {
  const companyNameById = new Map(companies.map((c) => [c._id, c.name]));
  if (affectedDeals.length === 0) return <EmptyPanel icon={TrendingUp} text="No Deals currently reference this Price Book." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Deal</th><th className="px-4 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Stage</th>
          <th className="px-4 py-3 font-medium">Owner</th><th className="px-4 py-3 font-medium">Price Book Value</th><th className="px-4 py-3 font-medium">Standard Catalog Value</th><th className="px-4 py-3 font-medium">Difference</th>
        </tr></thead>
        <tbody>
          {affectedDeals.map((d) => {
            const lines = (d.lineItems || []).filter((li) => li.priceBookId);
            return lines.map((li) => {
              const catalogItem = findCatalogItem(li.productId);
              const standardValue = catalogItem?.standardPrice;
              const diff = standardValue != null ? li.unitPrice - standardValue : null;
              return (
                <tr key={`${d._id}_${li._id}`} className="border-t border-gray-800">
                  <td className="px-4 py-3 font-medium"><Link to={`/crm/deals/${d._id}`} className="text-blue-400 hover:underline">{d.name}</Link></td>
                  <td className="px-4 py-3 text-gray-300">{companyNameById.get(d.companyId) || "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{d.stage}</td>
                  <td className="px-4 py-3 text-gray-300">{d.ownerName || "Unassigned"}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(li.unitPrice, d.currency)}</td>
                  <td className="px-4 py-3 text-gray-300">{standardValue != null ? formatMoney(standardValue, d.currency) : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{diff != null ? formatMoney(diff, d.currency) : "—"}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

function QuotesTab({ pb, companies }) {
  const companyNameById = new Map(companies.map((c) => [c._id, c.name]));
  const related = quotes.filter((q) => q.priceBookId === pb._id);
  if (related.length === 0) return <EmptyPanel icon={FileText} text="No Quotes currently reference this Price Book." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr><th className="px-4 py-3 font-medium">Quote</th><th className="px-4 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Status</th></tr></thead>
        <tbody>{related.map((q) => (
          <tr key={q._id} className="border-t border-gray-800">
            <td className="px-4 py-3 font-medium"><Link to={`/sales/quotes/${q._id}`} className="text-blue-400 hover:underline">{q.quoteNumber} (v{q.version})</Link></td>
            <td className="px-4 py-3 text-gray-300">{companyNameById.get(q.companyId) || "—"}</td>
            <td className="px-4 py-3 text-gray-300">{getQuoteEffectiveStatus(q)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function HistoryTab({ activity }) {
  if (activity.length === 0) return <EmptyPanel icon={Shield} text="No change history recorded yet." />;
  return (
    <ul className="space-y-2">
      {[...activity].reverse().map((a) => (
        <li key={a._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 text-sm flex justify-between">
          <span>{a.description}</span>
          <span className="text-gray-500 text-xs">{formatDateTime(a.at)} · {a.actor}</span>
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ auditLog }) {
  if (auditLog.length === 0) return <EmptyPanel icon={Shield} text="No audit events yet." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Actor</th><th className="px-4 py-3 font-medium">Action</th>
          <th className="px-4 py-3 font-medium">Field</th><th className="px-4 py-3 font-medium">Previous</th>
          <th className="px-4 py-3 font-medium">New</th><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Reason</th>
        </tr></thead>
        <tbody>
          {[...auditLog].reverse().map((e) => (
            <tr key={e._id} className="border-t border-gray-800">
              <td className="px-4 py-3 text-gray-300">{e.actor}</td>
              <td className="px-4 py-3 text-gray-300 capitalize">{e.action}</td>
              <td className="px-4 py-3 text-gray-300">{e.field || "—"}</td>
              <td className="px-4 py-3 text-gray-400">{String(e.before ?? "—")}</td>
              <td className="px-4 py-3 text-gray-300">{String(e.after ?? "—")}</td>
              <td className="px-4 py-3 text-gray-500">{formatDateTime(e.at)}</td>
              <td className="px-4 py-3 text-amber-300">{e.reason || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Visual preview only — backend audit integration is a later phase.</p>
    </div>
  );
}

function ArchiveDetailDialog({ pb, affectedDeals, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    await dispatch(archivePriceBook({ id: pb._id, reason }));
    onDone();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Archive Price Book" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Archive &quot;{pb.name}&quot;</h2>
        <p className="text-sm text-gray-400">Archived Price Books can&apos;t be selected for new Deal pricing, but remain visible in existing Deal previews and reachable via the Archived filter.</p>
        {affectedDeals.length > 0 && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200">{affectedDeals.length} Deal(s) currently reference this Price Book and will keep their existing values.</div>
        )}
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={!reason.trim()} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">Archive</button>
        </div>
      </form>
    </div>
  );
}

function StatusDetailDialog({ pb, allPriceBooks, affectedDeals, onClose, onDone }) {
  const dispatch = useDispatch();
  const [status, setStatus] = useState(pb.status === "Archived" ? "Draft" : pb.status);
  const containerRef = useFocusTrap(true, onClose);
  const warnings = status === "Active" ? computeActivationWarnings({ ...pb, status: "Active" }, { allPriceBooks: allPriceBooks.filter((p) => p._id !== pb._id) }) : [];
  const submit = async (e) => {
    e.preventDefault();
    await dispatch(updatePriceBook({ id: pb._id, changes: { status } }));
    onDone();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Change status" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold">Change Status — {pb.name}</h2>
        <select autoFocus value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          {SETTABLE_STATUSES.filter((s) => s !== "Archived").map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {warnings.length > 0 && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 space-y-1">
            <p className="font-medium flex items-center gap-1.5"><AlertTriangle size={13} /> Before activating:</p>
            <ul className="list-disc list-inside">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        {status === "Inactive" && affectedDeals.length > 0 && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200">{affectedDeals.length} Deal(s) currently reference this Price Book and will keep their existing values.</div>
        )}
        <p className="text-xs text-gray-500">Scheduled and Expired are derived automatically from the effective/expiration dates once Active.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">{warnings.length > 0 ? "Activate Anyway" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
