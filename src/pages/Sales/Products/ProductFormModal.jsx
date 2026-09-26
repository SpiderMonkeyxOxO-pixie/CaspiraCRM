import { useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import { createProduct, updateProduct } from "../../../redux/sales/productsSlice";
import {
  CATALOG_TYPES, CATALOG_STATUSES, BILLING_MODELS, BILLING_INTERVALS, CATALOG_CURRENCIES,
  CATALOG_CATEGORIES, TAX_CATEGORIES, USAGE_BILLING_UNITS, CATALOG_UNITS, PRICE_TREATMENTS, RENEWAL_BEHAVIORS,
  validateCatalogPayload, wouldCreateCircularPackage, buildDuplicatePreview, activeDealsUsingItem,
} from "../../../Helpers/mockCatalogData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney } from "./catalogUtils";

function emptyForm(type) {
  return {
    type: type || "Product", name: "", sku: "", category: "", shortDescription: "", description: "",
    ownerId: "", tags: "",
    billingModel: "One Time", billingInterval: "", unit: "Each", standardPrice: "", currency: "USD",
    discountEligible: true, minQuantity: 1, maxQuantity: "",
    usageConfig: { billingUnit: "", includedUsage: "", unitPrice: "", overagePrice: "", minimumUsage: "" },
    recurringConfig: { setupFee: "", minimumCommitmentMonths: "", renewalBehavior: RENEWAL_BEHAVIORS[0] },
    taxCategory: "Standard", effectiveDate: "", expirationDate: "", status: "Draft",
    includedItems: [], compatibleParentIds: [],
    termsSummary: "", internalNotes: "", customerFacingDescription: "",
  };
}

function formFromItem(item) {
  return {
    type: item.type, name: item.name || "", sku: item.sku || "", category: item.category || "",
    shortDescription: item.shortDescription || "", description: item.description || "",
    ownerId: item.ownerId || "", tags: (item.tags || []).join(", "),
    billingModel: item.billingModel || "One Time", billingInterval: item.billingInterval || "", unit: item.unit || "Each",
    standardPrice: item.standardPrice ?? "", currency: item.currency || "USD",
    discountEligible: item.discountEligible ?? true, minQuantity: item.minQuantity ?? 1, maxQuantity: item.maxQuantity ?? "",
    usageConfig: {
      billingUnit: item.usageConfig?.billingUnit || "", includedUsage: item.usageConfig?.includedUsage ?? "",
      unitPrice: item.usageConfig?.unitPrice ?? "", overagePrice: item.usageConfig?.overagePrice ?? "", minimumUsage: item.usageConfig?.minimumUsage ?? "",
    },
    recurringConfig: {
      setupFee: item.recurringConfig?.setupFee ?? "", minimumCommitmentMonths: item.recurringConfig?.minimumCommitmentMonths ?? "",
      renewalBehavior: item.recurringConfig?.renewalBehavior || RENEWAL_BEHAVIORS[0],
    },
    taxCategory: item.taxCategory || "Standard", effectiveDate: item.effectiveDate ? item.effectiveDate.slice(0, 10) : "",
    expirationDate: item.expirationDate ? item.expirationDate.slice(0, 10) : "", status: item.status || "Draft",
    includedItems: (item.includedItems || []).map((i) => ({ ...i, _key: Math.random().toString(36).slice(2) })),
    compatibleParentIds: item.compatibleParentIds || [],
    termsSummary: item.termsSummary || "", internalNotes: item.internalNotes || "", customerFacingDescription: item.customerFacingDescription || "",
  };
}

function emptyIncludedItem() {
  return { _key: Math.random().toString(36).slice(2), itemId: "", quantity: 1, included: true, priceTreatment: PRICE_TREATMENTS[0], order: 1 };
}

export default function ProductFormModal({ mode, type, item, onClose, onSaved }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const catalogItems = useSelector((s) => s.products.items);
  const isEdit = mode === "edit";
  const isDuplicate = mode === "duplicate";

  const [form, setForm] = useState(() => {
    if (isEdit) return formFromItem(item);
    if (isDuplicate) {
      const preview = buildDuplicatePreview(item._id);
      return formFromItem(preview);
    }
    return emptyForm(type);
  });
  const initialFormRef = useRef(form);
  const [errors, setErrors] = useState({});
  const [warnings, setWarnings] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const requestClose = () => (isDirty ? setConfirmClose(true) : onClose());
  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const setChecked = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.checked }));
  const setUsage = (field) => (e) => setForm((f) => ({ ...f, usageConfig: { ...f.usageConfig, [field]: e.target.value } }));
  const setRecurring = (field) => (e) => setForm((f) => ({ ...f, recurringConfig: { ...f.recurringConfig, [field]: e.target.value } }));

  const affectedDeals = isEdit ? activeDealsUsingItem(item._id) : [];
  const priceChanged = isEdit && Number(form.standardPrice) !== item.standardPrice;

  const packageCandidates = useMemo(() => catalogItems.filter((c) => c._id !== item?._id), [catalogItems, item]);
  const parentCandidates = useMemo(() => catalogItems.filter((c) => c._id !== item?._id && c.type !== "Add-on"), [catalogItems, item]);

  const addIncludedItem = () => setForm((f) => ({ ...f, includedItems: [...f.includedItems, { ...emptyIncludedItem(), order: f.includedItems.length + 1 }] }));
  const updateIncludedItem = (key, changes) => setForm((f) => ({ ...f, includedItems: f.includedItems.map((i) => (i._key === key ? { ...i, ...changes } : i)) }));
  const removeIncludedItem = (key) => setForm((f) => ({ ...f, includedItems: f.includedItems.filter((i) => i._key !== key) }));
  const moveIncludedItem = (key, dir) => setForm((f) => {
    const idx = f.includedItems.findIndex((i) => i._key === key);
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= f.includedItems.length) return f;
    const next = [...f.includedItems];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    return { ...f, includedItems: next.map((i, n) => ({ ...i, order: n + 1 })) };
  });

  const includedItemIds = form.includedItems.map((i) => i.itemId).filter(Boolean);
  const selfReferenced = includedItemIds.includes(item?._id);
  const circular = !selfReferenced && item?._id ? wouldCreateCircularPackage(item._id, includedItemIds, catalogItems) : false;

  const toggleParent = (id) => setForm((f) => ({
    ...f,
    compatibleParentIds: f.compatibleParentIds.includes(id) ? f.compatibleParentIds.filter((p) => p !== id) : [...f.compatibleParentIds, id],
  }));

  const buildPayload = () => ({
    type: form.type, name: form.name.trim(), sku: form.sku.trim(), category: form.category || null,
    shortDescription: form.shortDescription.trim(), description: form.description.trim(),
    ownerId: form.ownerId || null, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    billingModel: form.billingModel, billingInterval: form.billingModel === "Recurring" ? form.billingInterval || null : null,
    unit: form.unit, standardPrice: form.standardPrice === "" ? null : Number(form.standardPrice), currency: form.currency,
    discountEligible: form.discountEligible, minQuantity: Number(form.minQuantity) || 1,
    maxQuantity: form.maxQuantity === "" ? null : Number(form.maxQuantity),
    usageConfig: form.billingModel === "Usage Based" ? {
      billingUnit: form.usageConfig.billingUnit, includedUsage: Number(form.usageConfig.includedUsage) || 0,
      unitPrice: form.usageConfig.unitPrice === "" ? null : Number(form.usageConfig.unitPrice),
      overagePrice: form.usageConfig.overagePrice === "" ? null : Number(form.usageConfig.overagePrice),
      minimumUsage: Number(form.usageConfig.minimumUsage) || 0,
    } : null,
    recurringConfig: form.billingModel === "Recurring" ? {
      setupFee: Number(form.recurringConfig.setupFee) || 0,
      minimumCommitmentMonths: form.recurringConfig.minimumCommitmentMonths === "" ? null : Number(form.recurringConfig.minimumCommitmentMonths),
      renewalBehavior: form.recurringConfig.renewalBehavior,
    } : null,
    taxCategory: form.taxCategory, effectiveDate: form.effectiveDate ? new Date(form.effectiveDate).toISOString() : null,
    expirationDate: form.expirationDate ? new Date(form.expirationDate).toISOString() : null, status: form.status,
    includedItems: form.type === "Package" ? form.includedItems.map((li) => ({
      itemId: li.itemId, quantity: Number(li.quantity) || 1, included: li.included, priceTreatment: li.priceTreatment, order: li.order,
    })) : [],
    compatibleParentIds: form.type === "Add-on" ? form.compatibleParentIds : [],
    termsSummary: form.termsSummary, internalNotes: form.internalNotes, customerFacingDescription: form.customerFacingDescription,
  });

  const submit = async (e) => {
    e.preventDefault();
    const payload = buildPayload();
    const { errors: localErrors } = validateCatalogPayload(payload, { excludeId: isEdit ? item._id : undefined, allItems: catalogItems });
    if (selfReferenced) localErrors.includedItems = "A Package cannot include itself";
    else if (circular) localErrors.includedItems = "This would create a circular Package relationship";
    if (Object.keys(localErrors).length > 0) { setErrors(localErrors); return; }

    setSaving(true);
    setErrors({});
    if (isEdit) {
      const result = await dispatch(updateProduct({ id: item._id, changes: payload }));
      setSaving(false);
      if (updateProduct.fulfilled.match(result)) {
        setWarnings(result.payload?.warnings || {});
        initialFormRef.current = form;
        onSaved?.(result.payload.product ?? result.payload);
        onClose();
      } else {
        setErrors(result.payload?.errors || {});
      }
      return;
    }
    const result = await dispatch(createProduct(payload));
    setSaving(false);
    if (createProduct.fulfilled.match(result)) {
      onSaved?.(result.payload);
      onClose();
    } else if (result.payload?.errors) {
      setErrors(result.payload.errors);
    }
  };

  const titles = { add: `Add ${form.type}`, edit: `Edit ${item?.name}`, duplicate: `Duplicate "${item?.name}"` };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={requestClose}>
      <form
        ref={containerRef} onSubmit={submit} onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={titles[mode]}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-3xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">{titles[mode]}</h2>
          <button type="button" onClick={requestClose} aria-label="Close"><X size={20} /></button>
        </div>

        {isDuplicate && (
          <div className="bg-blue-900/15 border border-blue-800/30 rounded-lg p-3 text-xs text-blue-200">
            Review this copy before saving — configurable fields are copied, a new name and SKU are suggested, status is reset to Draft, and no historical usage carries over.
          </div>
        )}
        {isEdit && affectedDeals.length > 0 && priceChanged && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{affectedDeals.length} active Deal{affectedDeals.length === 1 ? "" : "s"} currently use this item. Changing the price here only updates the catalog — existing Deal line-item values are never changed retroactively without an explicit confirmation on that Deal.</span>
          </div>
        )}

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Basic information</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-type" className="block text-sm mb-1 text-gray-300">Item Type</label>
              <select id="item-type" value={form.type} onChange={set("type")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CATALOG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="item-name" className="block text-sm mb-1 text-gray-300">Name</label>
              <input id="item-name" value={form.name} onChange={set("name")} aria-invalid={!!errors.name}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.name ? "border-red-600" : "border-gray-700"}`} />
              {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-sku" className="block text-sm mb-1 text-gray-300">SKU / Service Code {(form.type === "Product" || form.type === "Service") && "*"}</label>
              <input id="item-sku" value={form.sku} onChange={set("sku")} aria-invalid={!!errors.sku}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.sku ? "border-red-600" : "border-gray-700"}`} />
              {errors.sku && <p className="text-xs text-red-400 mt-1">{errors.sku}</p>}
              {warnings.sku && !errors.sku && <p className="text-xs text-amber-400 mt-1">{warnings.sku}</p>}
            </div>
            <div>
              <label htmlFor="item-category" className="block text-sm mb-1 text-gray-300">Category</label>
              <select id="item-category" value={form.category} onChange={set("category")} aria-invalid={!!errors.category}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.category ? "border-red-600" : "border-gray-700"}`}>
                <option value="">Select a category...</option>
                {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {errors.category && <p className="text-xs text-red-400 mt-1">{errors.category}</p>}
            </div>
          </div>
          <div>
            <label htmlFor="item-short-desc" className="block text-sm mb-1 text-gray-300">Short Description</label>
            <input id="item-short-desc" value={form.shortDescription} onChange={set("shortDescription")} maxLength={120} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="item-description" className="block text-sm mb-1 text-gray-300">Full Description</label>
            <textarea id="item-description" value={form.description} onChange={set("description")} rows={3} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-owner" className="block text-sm mb-1 text-gray-300">Owner</label>
              <select id="item-owner" value={form.ownerId} onChange={set("ownerId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="item-tags" className="block text-sm mb-1 text-gray-300">Tags (comma separated)</label>
              <input id="item-tags" value={form.tags} onChange={set("tags")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Commercial configuration</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-billing-model" className="block text-sm mb-1 text-gray-300">Billing Model</label>
              <select id="item-billing-model" value={form.billingModel} onChange={set("billingModel")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {BILLING_MODELS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="item-unit" className="block text-sm mb-1 text-gray-300">Unit</label>
              <select id="item-unit" value={form.unit} onChange={set("unit")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CATALOG_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {(form.billingModel === "One Time" || form.billingModel === "Recurring") && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="item-price" className="block text-sm mb-1 text-gray-300">Standard Price</label>
                <input id="item-price" type="number" min="0" step="0.01" value={form.standardPrice} onChange={set("standardPrice")} aria-invalid={!!errors.standardPrice}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.standardPrice ? "border-red-600" : "border-gray-700"}`} />
                {errors.standardPrice && <p className="text-xs text-red-400 mt-1">{errors.standardPrice}</p>}
              </div>
              <div>
                <label htmlFor="item-currency" className="block text-sm mb-1 text-gray-300">Currency</label>
                <select id="item-currency" value={form.currency} onChange={set("currency")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {CATALOG_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}
          {form.billingModel === "Custom Quote" && (
            <p className="text-xs text-gray-500 bg-gray-800/30 rounded-lg p-3">Custom-Quote items have no standard price — pricing is always issued individually via a Quote.</p>
          )}
          <div className="grid sm:grid-cols-3 gap-4 items-end">
            <label className="flex items-center gap-2 text-sm text-gray-300 pb-2">
              <input type="checkbox" checked={form.discountEligible} onChange={setChecked("discountEligible")} /> Discount Eligible
            </label>
            <div>
              <label htmlFor="item-min-qty" className="block text-sm mb-1 text-gray-300">Minimum Quantity</label>
              <input id="item-min-qty" type="number" min="0" value={form.minQuantity} onChange={set("minQuantity")} aria-invalid={!!errors.minQuantity}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.minQuantity ? "border-red-600" : "border-gray-700"}`} />
              {errors.minQuantity && <p className="text-xs text-red-400 mt-1">{errors.minQuantity}</p>}
            </div>
            <div>
              <label htmlFor="item-max-qty" className="block text-sm mb-1 text-gray-300">Maximum Quantity</label>
              <input id="item-max-qty" type="number" min="0" value={form.maxQuantity} onChange={set("maxQuantity")} aria-invalid={!!errors.maxQuantity}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.maxQuantity ? "border-red-600" : "border-gray-700"}`} />
              {errors.maxQuantity && <p className="text-xs text-red-400 mt-1">{errors.maxQuantity}</p>}
            </div>
          </div>
        </fieldset>

        {form.billingModel === "Usage Based" && (
          <fieldset className="space-y-4 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Usage configuration</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="usage-unit" className="block text-sm mb-1 text-gray-300">Billing Unit</label>
                <select id="usage-unit" value={form.usageConfig.billingUnit} onChange={setUsage("billingUnit")} aria-invalid={!!errors.usageBillingUnit}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.usageBillingUnit ? "border-red-600" : "border-gray-700"}`}>
                  <option value="">Select a billing unit...</option>
                  {USAGE_BILLING_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                {errors.usageBillingUnit && <p className="text-xs text-red-400 mt-1">{errors.usageBillingUnit}</p>}
              </div>
              <div>
                <label htmlFor="usage-included" className="block text-sm mb-1 text-gray-300">Included Usage</label>
                <input id="usage-included" type="number" min="0" value={form.usageConfig.includedUsage} onChange={setUsage("includedUsage")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="usage-unit-price" className="block text-sm mb-1 text-gray-300">Unit Price</label>
                <input id="usage-unit-price" type="number" min="0" step="0.0001" value={form.usageConfig.unitPrice} onChange={setUsage("unitPrice")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="usage-overage" className="block text-sm mb-1 text-gray-300">Overage Price</label>
                <input id="usage-overage" type="number" min="0" step="0.0001" value={form.usageConfig.overagePrice} onChange={setUsage("overagePrice")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="usage-min-charge" className="block text-sm mb-1 text-gray-300">Minimum Charge</label>
                <input id="usage-min-charge" type="number" min="0" value={form.usageConfig.minimumUsage} onChange={setUsage("minimumUsage")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </fieldset>
        )}

        {form.billingModel === "Recurring" && (
          <fieldset className="space-y-4 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Recurring configuration</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="item-interval" className="block text-sm mb-1 text-gray-300">Billing Interval</label>
                <select id="item-interval" value={form.billingInterval} onChange={set("billingInterval")} aria-invalid={!!errors.billingInterval}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.billingInterval ? "border-red-600" : "border-gray-700"}`}>
                  <option value="">Select an interval...</option>
                  {BILLING_INTERVALS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                {errors.billingInterval && <p className="text-xs text-red-400 mt-1">{errors.billingInterval}</p>}
              </div>
              <div>
                <label htmlFor="recurring-setup-fee" className="block text-sm mb-1 text-gray-300">Setup Fee</label>
                <input id="recurring-setup-fee" type="number" min="0" value={form.recurringConfig.setupFee} onChange={setRecurring("setupFee")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="recurring-min-commit" className="block text-sm mb-1 text-gray-300">Minimum Commitment (months)</label>
                <input id="recurring-min-commit" type="number" min="0" value={form.recurringConfig.minimumCommitmentMonths} onChange={setRecurring("minimumCommitmentMonths")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="recurring-renewal" className="block text-sm mb-1 text-gray-300">Renewal Behavior (preview)</label>
                <select id="recurring-renewal" value={form.recurringConfig.renewalBehavior} onChange={setRecurring("renewalBehavior")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {RENEWAL_BEHAVIORS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-gray-500">For information only: nothing is billed automatically from this setting.</p>
          </fieldset>
        )}

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Tax and availability</legend>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="item-tax" className="block text-sm mb-1 text-gray-300">Tax Category</label>
              <select id="item-tax" value={form.taxCategory} onChange={set("taxCategory")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {TAX_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="item-status" className="block text-sm mb-1 text-gray-300">Status</label>
              <select id="item-status" value={form.status} onChange={set("status")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CATALOG_STATUSES.filter((s) => s !== "Archived").map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-effective" className="block text-sm mb-1 text-gray-300">Effective Date</label>
              <input id="item-effective" type="date" value={form.effectiveDate} onChange={set("effectiveDate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="item-expiration" className="block text-sm mb-1 text-gray-300">Expiration Date</label>
              <input id="item-expiration" type="date" value={form.expirationDate} onChange={set("expirationDate")} aria-invalid={!!errors.expirationDate}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.expirationDate ? "border-red-600" : "border-gray-700"}`} />
              {errors.expirationDate && <p className="text-xs text-red-400 mt-1">{errors.expirationDate}</p>}
            </div>
          </div>
        </fieldset>

        {form.type === "Package" && (
          <fieldset className="space-y-3 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Package configuration</legend>
            <button type="button" onClick={addIncludedItem} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm">
              <Plus size={14} /> Add Included Item
            </button>
            {errors.includedItems && <p className="text-xs text-red-400">{errors.includedItems}</p>}
            <div role="list" aria-label="Package contents" className="space-y-2">
              {form.includedItems.map((li, idx) => (
                <div key={li._key} role="listitem" className="grid grid-cols-12 gap-2 items-center bg-gray-800/30 rounded-lg p-2">
                  <select value={li.itemId} onChange={(e) => updateIncludedItem(li._key, { itemId: e.target.value })} className="col-span-4 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm">
                    <option value="">Select an item...</option>
                    {packageCandidates.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                  <input type="number" min="1" value={li.quantity} onChange={(e) => updateIncludedItem(li._key, { quantity: e.target.value })} aria-label={`Quantity for row ${idx + 1}`} className="col-span-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-center" />
                  <select value={li.included ? "included" : "optional"} onChange={(e) => updateIncludedItem(li._key, { included: e.target.value === "included" })} className="col-span-2 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm">
                    <option value="included">Included</option>
                    <option value="optional">Optional</option>
                  </select>
                  <select value={li.priceTreatment} onChange={(e) => updateIncludedItem(li._key, { priceTreatment: e.target.value })} className="col-span-3 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm">
                    {PRICE_TREATMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div className="col-span-1 flex justify-center gap-0.5">
                    <button type="button" onClick={() => moveIncludedItem(li._key, -1)} disabled={idx === 0} aria-label={`Move row ${idx + 1} up`} className="disabled:opacity-30"><ArrowUp size={13} /></button>
                    <button type="button" onClick={() => moveIncludedItem(li._key, 1)} disabled={idx === form.includedItems.length - 1} aria-label={`Move row ${idx + 1} down`} className="disabled:opacity-30"><ArrowDown size={13} /></button>
                  </div>
                  <button type="button" onClick={() => removeIncludedItem(li._key)} aria-label={`Remove row ${idx + 1}`} className="col-span-1 text-red-400 hover:text-red-300 flex justify-center"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {form.type === "Add-on" && (
          <fieldset className="space-y-3 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Add-on configuration</legend>
            <p className="text-sm text-gray-300 mb-1">Compatible parent Products, Services or Packages</p>
            <div className="flex flex-wrap gap-3 bg-gray-800/30 border border-gray-800 rounded-lg p-2 max-h-40 overflow-y-auto">
              {parentCandidates.map((c) => (
                <label key={c._id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={form.compatibleParentIds.includes(c._id)} onChange={() => toggleParent(c._id)} /> {c.name}
                </label>
              ))}
            </div>
            {errors.compatibleParentIds && <p className="text-xs text-red-400">{errors.compatibleParentIds}</p>}
          </fieldset>
        )}

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Terms</legend>
          <div>
            <label htmlFor="item-terms" className="block text-sm mb-1 text-gray-300">Terms Summary</label>
            <textarea id="item-terms" value={form.termsSummary} onChange={set("termsSummary")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div>
            <label htmlFor="item-internal-notes" className="block text-sm mb-1 text-gray-300">Internal Notes</label>
            <textarea id="item-internal-notes" value={form.internalNotes} onChange={set("internalNotes")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div>
            <label htmlFor="item-customer-desc" className="block text-sm mb-1 text-gray-300">Customer-Facing Description</label>
            <textarea id="item-customer-desc" value={form.customerFacingDescription} onChange={set("customerFacingDescription")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
        </fieldset>

        {form.standardPrice !== "" && !Number.isNaN(Number(form.standardPrice)) && (
          <div className="bg-gray-800/40 rounded-lg px-3 py-2 text-sm">
            <p className="text-xs text-gray-500">Pricing preview</p>
            <p className="font-semibold">{formatMoney(Number(form.standardPrice), form.currency)}{form.billingModel === "Recurring" && form.billingInterval ? ` per ${form.billingInterval.toLowerCase()}` : form.billingModel === "One Time" ? " one time" : ""}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button type="button" onClick={requestClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Save Item"}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 -mt-2">
          Existing quotes and orders keep the prices they were made with.
        </p>
      </form>

      {confirmClose && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold">Discard unsaved changes?</h3>
            <p className="text-sm text-gray-400">You have unsaved changes to this catalog item. Closing now will discard them.</p>
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
