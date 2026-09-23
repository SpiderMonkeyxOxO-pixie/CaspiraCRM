import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, Plus, Trash2, AlertTriangle, Check } from "lucide-react";
import { createPriceBook, updatePriceBook } from "../../../redux/sales/priceBooksSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import { catalogItems, findCatalogItem, CATALOG_CATEGORIES, BILLING_INTERVALS } from "../../../Helpers/mockCatalogData";
import {
  ADJUSTMENT_TYPES, MARKETS, CUSTOMER_SEGMENTS, SALES_CHANNELS, CONTRACT_TYPES, PRICE_BOOK_DEAL_TYPES,
  PRICE_BOOK_CURRENCIES, SETTABLE_STATUSES, MIN_PRIORITY, MAX_PRIORITY,
  validatePriceBookPayload, computeEntryFinalPrice, validateQuantityTiers, findConflicts,
  buildPriceBookDuplicatePreview, dealsUsingPriceBook,
} from "../../../Helpers/mockPriceBookData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatPercent } from "./priceBookUtils";

const STEPS = ["Basic Information", "Applicability", "Schedule", "Catalog Items", "Pricing", "Review"];

function emptyForm(template) {
  const base = {
    name: "", code: "", description: "", ownerId: "", tags: "",
    currency: "USD", market: "Global", customerSegment: "", companyIds: [], salesChannel: "",
    categories: [], dealTypes: [], contractTypes: [],
    effectiveDate: new Date().toISOString().slice(0, 10), expirationDate: "", priority: 10, status: "Draft",
    items: [],
  };
  if (template === "standard") return { ...base, name: "Standard Price Book", priority: 0 };
  if (template === "market") return { ...base, name: "", market: "", priority: 20 };
  return base;
}

function formFromPriceBook(pb) {
  return {
    name: pb.name || "", code: pb.code || "", description: pb.description || "", ownerId: pb.ownerId || "", tags: (pb.tags || []).join(", "),
    currency: pb.currency || "USD", market: pb.market || "", customerSegment: pb.customerSegment || "", companyIds: pb.companyIds || [],
    salesChannel: pb.salesChannel || "", categories: pb.categories || [], dealTypes: pb.dealTypes || [], contractTypes: pb.contractTypes || [],
    effectiveDate: pb.effectiveDate ? pb.effectiveDate.slice(0, 10) : "", expirationDate: pb.expirationDate ? pb.expirationDate.slice(0, 10) : "",
    priority: pb.priority ?? 10, status: pb.status || "Draft",
    items: (pb.items || []).map((i) => ({ ...i, tiers: (i.tiers || []).map((t) => ({ ...t })) })),
  };
}

function emptyItemEntry(catalogItem, bookCurrency) {
  return {
    catalogItemId: catalogItem._id, currency: bookCurrency, adjustmentType: "Fixed Price",
    adjustmentValue: catalogItem.standardPrice ?? 0, tiers: [],
    minQuantity: catalogItem.minQuantity || 1, maxQuantity: catalogItem.maxQuantity ?? null,
    billingInterval: catalogItem.billingInterval || null, effectiveDate: "", expirationDate: "", notes: "", enabled: true,
  };
}

export default function PriceBookFormModal({ mode, template, priceBook, initialStep = 0, onClose, onSaved }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const companies = useSelector((s) => s.companies.items);
  const allPriceBooks = useSelector((s) => s.priceBooks.items);
  const isEdit = mode === "edit";

  const [form, setForm] = useState(() => {
    if (mode === "duplicate") return formFromPriceBook(buildPriceBookDuplicatePreview(priceBook._id));
    if (mode === "edit") return formFromPriceBook(priceBook);
    return emptyForm(template);
  });
  const initialFormRef = useRef(form);
  const [step, setStep] = useState(initialStep);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [categoryToAdd, setCategoryToAdd] = useState("");

  useEffect(() => { dispatch(fetchCompanies()); }, [dispatch]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const requestClose = () => (isDirty ? setConfirmClose(true) : onClose());
  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const toggleArrayValue = (field, value) => setForm((f) => ({
    ...f, [field]: f[field].includes(value) ? f[field].filter((v) => v !== value) : [...f[field], value],
  }));

  const affectedDeals = isEdit ? dealsUsingPriceBook(priceBook._id) : [];

  // --- Catalog item management (Step 4) ---
  const addedIds = new Set(form.items.map((i) => i.catalogItemId));
  const searchResults = useMemo(() => {
    if (!itemSearch.trim()) return [];
    const q = itemSearch.trim().toLowerCase();
    return catalogItems.filter((c) => !addedIds.has(c._id) && (c.name.toLowerCase().includes(q) || (c.sku || "").toLowerCase().includes(q))).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSearch, form.items]);

  const addItem = (catalogItemId) => {
    const c = findCatalogItem(catalogItemId);
    if (!c || addedIds.has(catalogItemId)) return;
    setForm((f) => ({ ...f, items: [...f.items, emptyItemEntry(c, f.currency)] }));
    setItemSearch("");
  };
  const addAllFromCategory = () => {
    if (!categoryToAdd) return;
    const toAdd = catalogItems.filter((c) => c.category === categoryToAdd && !addedIds.has(c._id));
    setForm((f) => ({ ...f, items: [...f.items, ...toAdd.map((c) => emptyItemEntry(c, f.currency))] }));
  };
  const removeItem = (catalogItemId) => setForm((f) => ({ ...f, items: f.items.filter((i) => i.catalogItemId !== catalogItemId) }));
  const updateItem = (catalogItemId, changes) => setForm((f) => ({ ...f, items: f.items.map((i) => (i.catalogItemId === catalogItemId ? { ...i, ...changes } : i)) }));

  const addTier = (catalogItemId) => updateItem(catalogItemId, {
    tiers: [...(form.items.find((i) => i.catalogItemId === catalogItemId)?.tiers || []), { minQty: 1, maxQty: null, unitPrice: 0 }],
  });
  const updateTier = (catalogItemId, idx, changes) => {
    const item = form.items.find((i) => i.catalogItemId === catalogItemId);
    const tiers = item.tiers.map((t, i) => (i === idx ? { ...t, ...changes } : t));
    updateItem(catalogItemId, { tiers });
  };
  const removeTier = (catalogItemId, idx) => {
    const item = form.items.find((i) => i.catalogItemId === catalogItemId);
    updateItem(catalogItemId, { tiers: item.tiers.filter((_, i) => i !== idx) });
  };

  const missingPriceItems = form.items.filter((entry) => {
    if (entry.adjustmentType === "Custom Quote") return false;
    const c = findCatalogItem(entry.catalogItemId);
    if (!c) return true;
    const priced = computeEntryFinalPrice(entry, c, entry.minQuantity || 1);
    return priced?.finalPrice == null;
  });

  const buildPayload = () => ({
    name: form.name.trim(), code: form.code.trim(), description: form.description, ownerId: form.ownerId || null,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    currency: form.currency, market: form.market || "Global", customerSegment: form.customerSegment || null,
    companyIds: form.companyIds, salesChannel: form.salesChannel || null,
    categories: form.categories, dealTypes: form.dealTypes, contractTypes: form.contractTypes,
    effectiveDate: form.effectiveDate ? new Date(form.effectiveDate).toISOString() : null,
    expirationDate: form.expirationDate ? new Date(form.expirationDate).toISOString() : null,
    priority: Number(form.priority), status: form.status,
    items: form.items.map((i) => ({
      catalogItemId: i.catalogItemId, currency: i.currency, adjustmentType: i.adjustmentType,
      adjustmentValue: i.adjustmentType === "Custom Quote" || i.adjustmentType === "Quantity Tier" ? null : Number(i.adjustmentValue),
      tiers: i.adjustmentType === "Quantity Tier" ? i.tiers.map((t) => ({ minQty: Number(t.minQty), maxQty: t.maxQty === "" || t.maxQty == null ? null : Number(t.maxQty), unitPrice: Number(t.unitPrice) })) : [],
      minQuantity: Number(i.minQuantity) || 1, maxQuantity: i.maxQuantity === "" || i.maxQuantity == null ? null : Number(i.maxQuantity),
      billingInterval: i.billingInterval || null,
      effectiveDate: i.effectiveDate ? new Date(i.effectiveDate).toISOString() : null,
      expirationDate: i.expirationDate ? new Date(i.expirationDate).toISOString() : null,
      notes: i.notes || "", enabled: i.enabled !== false,
    })),
  });

  const previewPayload = buildPayload();
  const previewValidation = validatePriceBookPayload(previewPayload, { excludeId: isEdit ? priceBook._id : undefined });
  const previewConflicts = findConflicts({ ...previewPayload, _id: isEdit ? priceBook._id : "new", status: "Active" }, allPriceBooks.filter((p) => p._id !== priceBook?._id));

  const stepHasError = (idx) => {
    const keys = Object.keys(previewValidation.errors);
    if (idx === 0) return keys.some((k) => k === "name" || k === "code");
    if (idx === 1) return keys.some((k) => k === "currency" || k === "applicability");
    if (idx === 2) return keys.some((k) => k === "priority" || k === "expirationDate");
    if (idx === 3) return keys.some((k) => k === "items");
    if (idx === 4) return keys.some((k) => k.startsWith("item_"));
    return false;
  };

  const goNext = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const payload = buildPayload();

    if (isEdit) {
      const result = await dispatch(updatePriceBook({ id: priceBook._id, changes: payload }));
      setSaving(false);
      if (updatePriceBook.fulfilled.match(result)) {
        initialFormRef.current = form;
        onSaved?.(result.payload);
        onClose();
      } else {
        const errs = result.payload?.errors || {};
        setErrors(errs);
        jumpToFirstErrorStep(errs);
      }
      return;
    }

    const result = await dispatch(createPriceBook(payload));
    setSaving(false);
    if (createPriceBook.fulfilled.match(result)) {
      onSaved?.(result.payload);
      onClose();
    } else {
      const errs = result.payload?.errors || {};
      setErrors(errs);
      jumpToFirstErrorStep(errs);
    }
  };

  const jumpToFirstErrorStep = (errs) => {
    const keys = Object.keys(errs);
    if (keys.some((k) => k === "name" || k === "code")) return setStep(0);
    if (keys.some((k) => k === "currency" || k === "applicability")) return setStep(1);
    if (keys.some((k) => k === "priority" || k === "expirationDate")) return setStep(2);
    if (keys.some((k) => k === "items")) return setStep(3);
    if (keys.some((k) => k.startsWith("item_"))) return setStep(4);
  };

  const title = isEdit ? `Edit Price Book — ${priceBook.name}` : mode === "duplicate" ? `Duplicate Price Book — ${priceBook.name}` : "Create Price Book";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={requestClose}>
      <form
        ref={containerRef} onSubmit={submit} onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={title}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-4xl p-6 space-y-5 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={requestClose} aria-label="Close"><X size={20} /></button>
        </div>

        <ol aria-label="Price Book creation steps" className="flex flex-wrap gap-1 text-xs">
          {STEPS.map((label, idx) => (
            <li key={label}>
              <button type="button" onClick={() => setStep(idx)} aria-current={step === idx ? "step" : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${step === idx ? "bg-blue-700 border-blue-600 text-white" : stepHasError(idx) ? "border-red-700 text-red-300" : "border-gray-700 text-gray-400 hover:text-white"}`}>
                <span className="w-4 h-4 rounded-full bg-black/20 flex items-center justify-center text-[10px]">{idx + 1}</span>
                {label}
                {stepHasError(idx) && <AlertTriangle size={11} />}
              </button>
            </li>
          ))}
        </ol>

        {affectedDeals.length > 0 && step === 4 && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{affectedDeals.length} Deal(s) currently reference this Price Book. Existing Deal line-item values are never changed retroactively — this only affects future price resolution.</span>
          </div>
        )}

        {step === 0 && (
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Basic information</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pb-name" className="block text-sm mb-1 text-gray-300">Name</label>
                <input id="pb-name" value={form.name} onChange={set("name")} aria-invalid={!!errors.name}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.name ? "border-red-600" : "border-gray-700"}`} />
                {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
              </div>
              <div>
                <label htmlFor="pb-code" className="block text-sm mb-1 text-gray-300">Code</label>
                <input id="pb-code" value={form.code} onChange={set("code")} aria-invalid={!!errors.code}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.code ? "border-red-600" : "border-gray-700"}`} />
                {errors.code && <p className="text-xs text-red-400 mt-1">{errors.code}</p>}
                {mode === "duplicate" && !errors.code && <p className="text-xs text-gray-500 mt-1">A duplicate must be given a brand-new, unique code.</p>}
              </div>
            </div>
            <div>
              <label htmlFor="pb-description" className="block text-sm mb-1 text-gray-300">Description</label>
              <textarea id="pb-description" value={form.description} onChange={set("description")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pb-owner" className="block text-sm mb-1 text-gray-300">Owner</label>
                <select id="pb-owner" value={form.ownerId} onChange={set("ownerId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">Unassigned</option>
                  {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="pb-tags" className="block text-sm mb-1 text-gray-300">Tags (comma separated)</label>
                <input id="pb-tags" value={form.tags} onChange={set("tags")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Applicability</legend>
            <p className="text-xs text-gray-500">Broad scope (Global market, no other restriction) applies everywhere. Narrower rules make this Price Book more specific and give it priority over broader ones.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pb-currency" className="block text-sm mb-1 text-gray-300">Currency</label>
                <select id="pb-currency" value={form.currency} onChange={set("currency")} aria-invalid={!!errors.currency} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.currency ? "border-red-600" : "border-gray-700"}`}>
                  {PRICE_BOOK_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {errors.currency && <p className="text-xs text-red-400 mt-1">{errors.currency}</p>}
              </div>
              <div>
                <label htmlFor="pb-market" className="block text-sm mb-1 text-gray-300">Market or Country</label>
                <select id="pb-market" value={form.market} onChange={set("market")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="Global">Global (all markets)</option>
                  {MARKETS.filter((m) => m !== "Global").map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pb-segment" className="block text-sm mb-1 text-gray-300">Customer Segment</label>
                <select id="pb-segment" value={form.customerSegment} onChange={set("customerSegment")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">Any segment</option>
                  {CUSTOMER_SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="pb-channel" className="block text-sm mb-1 text-gray-300">Sales Channel</label>
                <select id="pb-channel" value={form.salesChannel} onChange={set("salesChannel")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">Any channel</option>
                  {SALES_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <p className="text-sm mb-1 text-gray-300">Specific Companies</p>
              <div className="max-h-32 overflow-y-auto bg-gray-800/30 border border-gray-800 rounded-lg p-2 flex flex-wrap gap-3">
                {companies.slice(0, 100).map((c) => (
                  <label key={c._id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={form.companyIds.includes(c._id)} onChange={() => toggleArrayValue("companyIds", c._id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm mb-1 text-gray-300">Applicable Product Categories</p>
              <div className="flex flex-wrap gap-3 bg-gray-800/30 border border-gray-800 rounded-lg p-2">
                {CATALOG_CATEGORIES.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={form.categories.includes(c)} onChange={() => toggleArrayValue("categories", c)} />
                    {c}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm mb-1 text-gray-300">Deal Types</p>
                <div className="flex flex-wrap gap-3 bg-gray-800/30 border border-gray-800 rounded-lg p-2">
                  {PRICE_BOOK_DEAL_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={form.dealTypes.includes(t)} onChange={() => toggleArrayValue("dealTypes", t)} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm mb-1 text-gray-300">Contract Types</p>
                <div className="flex flex-wrap gap-3 bg-gray-800/30 border border-gray-800 rounded-lg p-2">
                  {CONTRACT_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={form.contractTypes.includes(t)} onChange={() => toggleArrayValue("contractTypes", t)} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {errors.applicability && <p className="text-xs text-red-400">{errors.applicability}</p>}
          </fieldset>
        )}

        {step === 2 && (
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Schedule</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pb-effective" className="block text-sm mb-1 text-gray-300">Effective Date</label>
                <input id="pb-effective" type="date" value={form.effectiveDate} onChange={set("effectiveDate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="pb-expiration" className="block text-sm mb-1 text-gray-300">Expiration Date</label>
                <input id="pb-expiration" type="date" value={form.expirationDate} onChange={set("expirationDate")} aria-invalid={!!errors.expirationDate}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.expirationDate ? "border-red-600" : "border-gray-700"}`} />
                {errors.expirationDate && <p className="text-xs text-red-400 mt-1">{errors.expirationDate}</p>}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pb-priority" className="block text-sm mb-1 text-gray-300">Priority ({MIN_PRIORITY}–{MAX_PRIORITY})</label>
                <input id="pb-priority" type="number" min={MIN_PRIORITY} max={MAX_PRIORITY} value={form.priority} onChange={set("priority")} aria-invalid={!!errors.priority}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.priority ? "border-red-600" : "border-gray-700"}`} />
                {errors.priority && <p className="text-xs text-red-400 mt-1">{errors.priority}</p>}
                <p className="text-xs text-gray-500 mt-1">Used only when two Price Books tie on specificity — company beats contract beats segment beats market beats channel beats standard.</p>
              </div>
              <div>
                <label htmlFor="pb-status" className="block text-sm mb-1 text-gray-300">Status</label>
                <select id="pb-status" value={form.status} onChange={set("status")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {SETTABLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <p className="text-xs text-gray-500 mt-1">When Active, Scheduled/Expired are derived automatically from the dates above.</p>
              </div>
            </div>
          </fieldset>
        )}

        {step === 3 && (
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Catalog items</legend>
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex-1 min-w-52">
                <label htmlFor="pb-item-search" className="block text-sm mb-1 text-gray-300">Search Products &amp; Services</label>
                <input id="pb-item-search" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search by name or SKU..." className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="pb-category-add" className="block text-sm mb-1 text-gray-300">Add all from category</label>
                <div className="flex gap-2">
                  <select id="pb-category-add" value={categoryToAdd} onChange={(e) => setCategoryToAdd(e.target.value)} className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select category...</option>
                    {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button type="button" onClick={addAllFromCategory} disabled={!categoryToAdd} className="px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm disabled:opacity-50">Add All</button>
                </div>
              </div>
            </div>
            {searchResults.length > 0 && (
              <div className="border border-gray-800 rounded-lg divide-y divide-gray-800 max-h-48 overflow-y-auto">
                {searchResults.map((c) => (
                  <button key={c._id} type="button" onClick={() => addItem(c._id)} className="w-full text-left flex justify-between items-center px-3 py-2 text-sm hover:bg-gray-800">
                    <span>{c.name} <span className="text-gray-500 text-xs">({c.type})</span></span>
                    <Plus size={14} className="text-blue-400" />
                  </button>
                ))}
              </div>
            )}
            {errors.items && <p className="text-xs text-red-400">{errors.items}</p>}
            <div className="space-y-1">
              <p className="text-sm text-gray-300">{form.items.length} item{form.items.length === 1 ? "" : "s"} added</p>
              {form.items.length === 0 ? (
                <p className="text-sm text-gray-500">No catalog items added yet — search above or add an entire category.</p>
              ) : (
                <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
                  {form.items.map((entry) => {
                    const c = findCatalogItem(entry.catalogItemId);
                    return (
                      <div key={entry.catalogItemId} className="flex justify-between items-center px-3 py-2 text-sm">
                        <span>{c?.name || "Unknown item"} <span className="text-gray-500 text-xs">({c?.type})</span></span>
                        <button type="button" onClick={() => removeItem(entry.catalogItemId)} aria-label={`Exclude ${c?.name || "item"}`} className="text-red-400 hover:text-red-300 flex items-center gap-1 text-xs">
                          <Trash2 size={13} /> Exclude
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {missingPriceItems.length > 0 && (
              <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{missingPriceItems.length} item(s) don&apos;t yet resolve to a price — configure pricing in the next step.</span>
              </div>
            )}
          </fieldset>
        )}

        {step === 4 && (
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Pricing</legend>
            {form.items.length === 0 ? (
              <p className="text-sm text-gray-500">Add catalog items in the previous step first.</p>
            ) : (
              <div className="space-y-4">
                {form.items.map((entry) => {
                  const c = findCatalogItem(entry.catalogItemId);
                  if (!c) return null;
                  const priced = computeEntryFinalPrice(entry, c, entry.minQuantity || 1);
                  const tierErrors = entry.adjustmentType === "Quantity Tier" ? validateQuantityTiers(entry.tiers) : [];
                  const errKey = Object.keys(errors).find((k) => k.startsWith("item_") && errors[k]?.includes?.(c.name));
                  return (
                    <div key={entry.catalogItemId} className="border border-gray-800 rounded-xl p-3 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-sm">{c.name}</span>
                        <label className="flex items-center gap-1.5 text-xs text-gray-400">
                          <input type="checkbox" checked={entry.enabled !== false} onChange={(e) => updateItem(entry.catalogItemId, { enabled: e.target.checked })} /> Enabled
                        </label>
                      </div>
                      <div className="grid sm:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-xs mb-1 text-gray-400">Adjustment Type</label>
                          <select value={entry.adjustmentType} onChange={(e) => updateItem(entry.catalogItemId, { adjustmentType: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                            {ADJUSTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        {entry.adjustmentType !== "Custom Quote" && entry.adjustmentType !== "Quantity Tier" && (
                          <div>
                            <label className="block text-xs mb-1 text-gray-400">Value</label>
                            <input type="number" value={entry.adjustmentValue ?? ""} onChange={(e) => updateItem(entry.catalogItemId, { adjustmentValue: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                          </div>
                        )}
                        <div>
                          <label className="block text-xs mb-1 text-gray-400">Entry Currency</label>
                          <select value={entry.currency} onChange={(e) => updateItem(entry.catalogItemId, { currency: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                            {PRICE_BOOK_CURRENCIES.map((cur) => <option key={cur} value={cur}>{cur}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs mb-1 text-gray-400">Billing Interval</label>
                          <select value={entry.billingInterval || ""} onChange={(e) => updateItem(entry.catalogItemId, { billingInterval: e.target.value || null })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                            <option value="">Any</option>
                            {BILLING_INTERVALS.map((b) => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-xs mb-1 text-gray-400">Min Quantity</label>
                          <input type="number" min="0" value={entry.minQuantity} onChange={(e) => updateItem(entry.catalogItemId, { minQuantity: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs mb-1 text-gray-400">Max Quantity</label>
                          <input type="number" min="0" value={entry.maxQuantity ?? ""} onChange={(e) => updateItem(entry.catalogItemId, { maxQuantity: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs mb-1 text-gray-400">Notes</label>
                          <input value={entry.notes} onChange={(e) => updateItem(entry.catalogItemId, { notes: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                      </div>

                      {entry.adjustmentType === "Quantity Tier" && (
                        <div className="bg-gray-800/30 rounded-lg p-2 space-y-2">
                          <p className="text-xs text-gray-400">Quantity tiers</p>
                          {entry.tiers.map((t, idx) => (
                            <div key={idx} className="grid grid-cols-4 gap-2 items-center">
                              <input type="number" placeholder="Min" value={t.minQty} onChange={(e) => updateTier(entry.catalogItemId, idx, { minQty: e.target.value })} className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm" />
                              <input type="number" placeholder="Max (blank = ∞)" value={t.maxQty ?? ""} onChange={(e) => updateTier(entry.catalogItemId, idx, { maxQty: e.target.value })} className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm" />
                              <input type="number" placeholder="Unit price" value={t.unitPrice} onChange={(e) => updateTier(entry.catalogItemId, idx, { unitPrice: e.target.value })} className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm" />
                              <button type="button" onClick={() => removeTier(entry.catalogItemId, idx)} aria-label="Remove tier" className="text-red-400 hover:text-red-300 flex justify-center"><Trash2 size={13} /></button>
                            </div>
                          ))}
                          <button type="button" onClick={() => addTier(entry.catalogItemId)} className="flex items-center gap-1 text-xs text-blue-400 hover:underline"><Plus size={12} /> Add tier</button>
                          {tierErrors.length > 0 && <p className="text-xs text-red-400">{tierErrors.join("; ")}</p>}
                        </div>
                      )}

                      <div className="bg-gray-800/40 rounded-lg px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
                        <span>Base: {priced.basePrice != null ? formatMoney(priced.basePrice, c.currency) : "—"}</span>
                        <span>Final: {priced.finalPrice != null ? formatMoney(priced.finalPrice, entry.currency) : entry.adjustmentType === "Custom Quote" ? "Custom Quote" : "Not resolvable"}</span>
                        {priced.sameCurrency ? (
                          <>
                            <span>Difference: {priced.difference != null ? formatMoney(priced.difference, entry.currency) : "—"}</span>
                            <span>% Difference: {priced.percentDifference != null ? formatPercent(priced.percentDifference) : "—"}</span>
                          </>
                        ) : (
                          <span className="text-gray-500">Different currency from catalog — no direct comparison shown.</span>
                        )}
                      </div>
                      {errKey && <p className="text-xs text-red-400">{errors[errKey]}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </fieldset>
        )}

        {step === 5 && (
          <fieldset className="space-y-4">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Review</legend>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div className="bg-gray-800/30 rounded-lg p-3 space-y-1">
                <p><span className="text-gray-500">Name:</span> {form.name || "—"}</p>
                <p><span className="text-gray-500">Code:</span> {form.code || "—"}</p>
                <p><span className="text-gray-500">Currency:</span> {form.currency}</p>
                <p><span className="text-gray-500">Priority:</span> {form.priority}</p>
                <p><span className="text-gray-500">Status:</span> {form.status}</p>
              </div>
              <div className="bg-gray-800/30 rounded-lg p-3 space-y-1">
                <p><span className="text-gray-500">Effective:</span> {form.effectiveDate || "—"}</p>
                <p><span className="text-gray-500">Expiration:</span> {form.expirationDate || "None"}</p>
                <p><span className="text-gray-500">Catalog items:</span> {form.items.length}</p>
                <p><span className="text-gray-500">Missing prices:</span> {missingPriceItems.length}</p>
              </div>
            </div>
            <div className="bg-gray-800/30 rounded-lg p-3 text-sm">
              <p className="text-gray-500 text-xs mb-1">Scope</p>
              <p>{form.market || "Global"}{form.customerSegment ? ` · ${form.customerSegment}` : ""}{form.salesChannel ? ` · ${form.salesChannel}` : ""}{form.companyIds.length ? ` · ${form.companyIds.length} specific company(ies)` : ""}</p>
            </div>
            {previewConflicts.length > 0 && (
              <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3 text-xs text-red-200 space-y-1">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> {previewConflicts.length} potential conflict(s) detected</p>
                {previewConflicts.map((c) => <p key={c.priceBookId}>{c.priceBookName}: {c.resolution}</p>)}
              </div>
            )}
            {Object.keys(previewValidation.errors).length > 0 && (
              <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3 text-xs text-red-200">
                <p className="font-medium mb-1">Fix these before saving:</p>
                <ul className="list-disc list-inside space-y-0.5">{Object.values(previewValidation.errors).map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            <p className="text-xs text-gray-500">
              {isEdit ? "Saving updates this Price Book in this session's shared frontend state only." : "Confirming adds this Price Book to this session's shared frontend state only — no backend record is created."}
            </p>
          </fieldset>
        )}

        <div className="flex justify-between pt-2 border-t border-gray-800">
          <button type="button" onClick={requestClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <div className="flex gap-2">
            {step > 0 && <button type="button" onClick={goBack} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Back</button>}
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={goNext} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Next</button>
            ) : (
              <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
                <Check size={15} /> {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Price Book"}
              </button>
            )}
          </div>
        </div>
      </form>

      {confirmClose && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold">Discard unsaved changes?</h3>
            <p className="text-sm text-gray-400">You have unsaved changes to this Price Book. Closing now will discard them.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmClose(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Keep Editing</button>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
