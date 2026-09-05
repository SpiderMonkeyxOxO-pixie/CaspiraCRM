import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { X, Plus, Trash2, AlertTriangle } from "lucide-react";
import {
  createDeal, updateDeal,
  DEAL_PIPELINES, DEAL_STAGES, DEAL_STAGE_PROBABILITY, DEAL_STAGE_RECOMMENDATIONS, DEAL_TYPES,
  DEAL_SOURCES, DEAL_CURRENCIES, DEAL_PRIORITIES, DEAL_HEALTH_STATES, DEAL_BILLING_FREQUENCIES,
  computeLineItemTotals,
} from "../../../redux/crm/dealsSlice";
import { fetchProducts } from "../../../redux/sales/productsSlice";
import { fetchPriceBooks } from "../../../redux/sales/priceBooksSlice";
import { resolvePrice } from "../../../Helpers/mockPriceBookData";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney } from "./dealUtils";

const ACTIVITY_TYPES_FOR_NEXT = ["Call", "Email", "Meeting", "Follow-up", "Task"];
// Maps a catalog billing interval onto the Deal line item's own (narrower)
// billing-frequency vocabulary — Deals don't yet support Weekly/Semiannual/
// Custom intervals, so those fall back to "One-time" rather than guessing.
const INTERVAL_TO_DEAL_FREQUENCY = { Monthly: "Monthly", Quarterly: "Quarterly", Annual: "Annually" };

function emptyLineItem() {
  return { _key: Math.random().toString(36).slice(2), productId: "", name: "", description: "", quantity: 1, unitPrice: 0, discountPercent: 0, billingFrequency: "One-time", priceBookId: null };
}

function emptyForm(rawPrefill) {
  const prefill = rawPrefill || {};
  const stage = prefill.stage || "Discovery";
  return {
    name: prefill.name || "", companyId: prefill.companyId || "", primaryContactId: prefill.primaryContactId || "",
    additionalContactIds: prefill.additionalContactIds || [], dealType: "New Business", source: "Website", description: "",
    pipeline: prefill.pipeline || "New Business", stage, value: "", currency: "USD", probability: DEAL_STAGE_PROBABILITY[stage] ?? DEAL_STAGE_PROBABILITY.Discovery,
    expectedClosingDate: "", priority: "Medium", dealHealth: "Healthy",
    ownerId: prefill.ownerId || "", assignedTeam: "",
    lineItems: [],
    nextAction: "", nextActivityType: "Call", nextActivityDate: "", reminder: false,
    competitors: "", tags: "", internalNote: "",
  };
}

function formFromDeal(deal) {
  return {
    name: deal.name || "", companyId: deal.companyId || "", primaryContactId: deal.primaryContactId || "",
    additionalContactIds: deal.additionalContactIds || [], dealType: deal.dealType || "New Business",
    source: deal.source || "Website", description: deal.description || "",
    pipeline: deal.pipeline || "New Business", stage: deal.stage, value: deal.value ?? "", currency: deal.currency || "USD",
    probability: deal.probability ?? 10, expectedClosingDate: deal.expectedClosingDate ? deal.expectedClosingDate.slice(0, 10) : "",
    priority: deal.priority || "Medium", dealHealth: deal.dealHealth || "Healthy",
    ownerId: deal.ownerId || "", assignedTeam: deal.assignedTeam || "",
    lineItems: (deal.lineItems || []).map((li) => ({ _key: li._id, productId: li.productId || "", name: li.name, description: li.description || "", quantity: li.quantity, unitPrice: li.unitPrice, discountPercent: li.discountPercent || 0, billingFrequency: li.billingFrequency || "One-time", priceBookId: li.priceBookId || null })),
    nextAction: deal.nextAction || "", nextActivityType: "Call", nextActivityDate: "", reminder: false,
    competitors: (deal.competitors || []).join(", "), tags: (deal.tags || []).join(", "), internalNote: deal.internalNote || "",
  };
}

function stageWarnings(form) {
  const warnings = [];
  const recs = DEAL_STAGE_RECOMMENDATIONS[form.stage];
  if (!recs) return warnings;
  if (form.stage === "Qualified") {
    if (!form.companyId) warnings.push("Company");
    if (!form.primaryContactId) warnings.push("Primary contact");
    if (!form.value) warnings.push("Estimated value");
    if (!form.ownerId) warnings.push("Owner");
  } else if (form.stage === "Proposal") {
    if (form.lineItems.length === 0) warnings.push("At least one product or service");
    if (!form.expectedClosingDate) warnings.push("Expected closing date");
    if (!form.nextAction.trim()) warnings.push("Next action");
  } else if (form.stage === "Negotiation") {
    if (!form.description.trim()) warnings.push("Known concerns documented");
  } else if (form.stage === "Approval") {
    if (!form.value) warnings.push("Final value confirmed");
    if (!form.description.trim()) warnings.push("Commercial summary");
  }
  return warnings;
}

// Shared by "Add Deal" (DealsList) and "Edit" (DealDetail).
export default function DealFormModal({ deal, prefill, onClose, onSaved }) {
  const dispatch = useDispatch();
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const products = useSelector((s) => s.products.items);
  const priceBooks = useSelector((s) => s.priceBooks.items);
  const isEdit = !!deal;

  const [form, setForm] = useState(() => (isEdit ? formFromDeal(deal) : emptyForm(prefill)));
  const initialFormRef = useRef(form);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [productPick, setProductPick] = useState("");
  const [priceBookCheck, setPriceBookCheck] = useState(null); // { key, result }

  useEffect(() => {
    dispatch(fetchProducts());
    dispatch(fetchPriceBooks());
  }, [dispatch]);

  const checkPriceBook = (li) => {
    const result = resolvePrice({
      date: new Date().toISOString(), companyId: form.companyId || undefined, currency: form.currency,
      dealType: form.dealType, catalogItemId: li.productId, quantity: Number(li.quantity) || 1,
    }, { allPriceBooks: priceBooks });
    setPriceBookCheck({ key: li._key, result });
  };
  const applyPriceBookPrice = (key, result) => {
    const resolved = result.winner || null;
    const finalPrice = resolved ? resolved.finalPrice : result.fallback?.finalPrice;
    if (finalPrice == null) return;
    updateLine(key, { unitPrice: finalPrice, priceBookId: resolved ? resolved.priceBook._id : null });
    setPriceBookCheck(null);
  };

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const requestClose = () => (isDirty ? setConfirmClose(true) : onClose());
  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const setStage = (e) => {
    const stage = e.target.value;
    setForm((f) => ({ ...f, stage, probability: DEAL_STAGE_PROBABILITY[stage] ?? f.probability }));
  };

  const companyContacts = useMemo(() => allContacts.filter((c) => c.companyId === form.companyId), [allContacts, form.companyId]);
  // Archived (and Draft/Inactive) catalog items can't be selected for a new
  // line item — an archived item stays visible only in Deals that already
  // reference it, never as a choice for a new one.
  const selectableCatalogItems = useMemo(() => products.filter((p) => p.status === "Active" && !p.archived), [products]);

  const setCompany = (e) => {
    const companyId = e.target.value;
    setForm((f) => ({ ...f, companyId, primaryContactId: "", additionalContactIds: [] }));
  };

  const toggleAdditionalContact = (contactId) => {
    setForm((f) => ({
      ...f,
      additionalContactIds: f.additionalContactIds.includes(contactId)
        ? f.additionalContactIds.filter((id) => id !== contactId)
        : [...f.additionalContactIds, contactId],
    }));
  };

  const addProductLine = () => {
    const product = selectableCatalogItems.find((p) => p._id === productPick);
    setForm((f) => ({
      ...f,
      lineItems: [...f.lineItems, product
        ? {
            ...emptyLineItem(), productId: product._id, name: product.name, description: product.shortDescription || "",
            unitPrice: product.standardPrice ?? 0, billingFrequency: INTERVAL_TO_DEAL_FREQUENCY[product.billingInterval] || "One-time",
          }
        : emptyLineItem()],
    }));
    setProductPick("");
  };
  const updateLine = (key, changes) => setForm((f) => ({ ...f, lineItems: f.lineItems.map((li) => (li._key === key ? { ...li, ...changes } : li)) }));
  const removeLine = (key) => setForm((f) => ({ ...f, lineItems: f.lineItems.filter((li) => li._key !== key) }));

  const totals = useMemo(() => computeLineItemTotals(form.lineItems), [form.lineItems]);
  const weightedValue = Math.round((Number(form.value) || 0) * ((Number(form.probability) || 0) / 100));
  const warnings = stageWarnings(form);

  const buildPayload = () => ({
    name: form.name.trim(), companyId: form.companyId || null, primaryContactId: form.primaryContactId || null,
    additionalContactIds: form.additionalContactIds, dealType: form.dealType, source: form.source, description: form.description,
    pipeline: form.pipeline, stage: form.stage, value: form.value === "" ? 0 : Number(form.value), currency: form.currency,
    probability: Number(form.probability), expectedClosingDate: form.expectedClosingDate ? new Date(form.expectedClosingDate).toISOString() : null,
    priority: form.priority, dealHealth: form.dealHealth, ownerId: form.ownerId || null, assignedTeam: form.assignedTeam || null,
    lineItems: form.lineItems.map((li) => ({
      productId: li.productId || null, name: li.name, description: li.description,
      quantity: Number(li.quantity), unitPrice: Number(li.unitPrice), discountPercent: Number(li.discountPercent) || 0,
      billingFrequency: li.billingFrequency, priceBookId: li.priceBookId || null,
    })),
    nextAction: form.nextAction.trim() || null,
    competitors: form.competitors.split(",").map((c) => c.trim()).filter(Boolean),
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    internalNote: form.internalNote,
  });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const payload = buildPayload();

    if (isEdit) {
      const result = await dispatch(updateDeal({ id: deal._id, changes: payload }));
      setSaving(false);
      if (updateDeal.fulfilled.match(result)) {
        initialFormRef.current = form;
        onSaved?.(result.payload);
        onClose();
      } else {
        setErrors(result.payload?.errors || {});
      }
      return;
    }

    const result = await dispatch(createDeal(payload));
    setSaving(false);
    if (createDeal.fulfilled.match(result)) {
      onSaved?.(result.payload);
      onClose();
    } else if (result.payload?.errors) {
      setErrors(result.payload.errors);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={requestClose}>
      <form
        ref={containerRef}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={isEdit ? "Edit Deal" : "New Deal"}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-3xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">{isEdit ? "Edit Deal" : "New Deal"}</h2>
          <button type="button" onClick={requestClose} aria-label="Close"><X size={20} /></button>
        </div>

        {warnings.length > 0 && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span><strong>Recommended for {form.stage}:</strong> {warnings.join(", ")}. This is a frontend warning only, not enforced.</span>
          </div>
        )}

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Basic information</legend>
          <div>
            <label htmlFor="deal-name" className="block text-sm mb-1 text-gray-300">Deal Name</label>
            <input id="deal-name" value={form.name} onChange={set("name")} aria-invalid={!!errors.name}
              className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.name ? "border-red-600" : "border-gray-700"}`} />
            {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="deal-company" className="block text-sm mb-1 text-gray-300">Company</label>
              <select id="deal-company" value={form.companyId} onChange={setCompany} aria-invalid={!!errors.companyId}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.companyId ? "border-red-600" : "border-gray-700"}`}>
                <option value="">Select a company...</option>
                {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
              {errors.companyId && <p className="text-xs text-red-400 mt-1">{errors.companyId}</p>}
            </div>
            <div>
              <label htmlFor="deal-primary-contact" className="block text-sm mb-1 text-gray-300">Primary Contact</label>
              <select id="deal-primary-contact" value={form.primaryContactId} onChange={set("primaryContactId")} disabled={!form.companyId}
                aria-invalid={!!errors.primaryContactId} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${errors.primaryContactId ? "border-red-600" : "border-gray-700"}`}>
                <option value="">{form.companyId ? "Select a contact..." : "Select a company first"}</option>
                {companyContacts.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
              {errors.primaryContactId && <p className="text-xs text-red-400 mt-1">{errors.primaryContactId}</p>}
            </div>
          </div>
          {form.companyId && companyContacts.length > 1 && (
            <div>
              <p className="text-sm mb-1 text-gray-300">Additional Contacts</p>
              <div className="flex flex-wrap gap-3 bg-gray-800/30 border border-gray-800 rounded-lg p-2">
                {companyContacts.filter((c) => c._id !== form.primaryContactId).map((c) => (
                  <label key={c._id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={form.additionalContactIds.includes(c._id)} onChange={() => toggleAdditionalContact(c._id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="deal-type" className="block text-sm mb-1 text-gray-300">Deal Type</label>
              <select id="deal-type" value={form.dealType} onChange={set("dealType")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {DEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="deal-source" className="block text-sm mb-1 text-gray-300">Source</label>
              <select id="deal-source" value={form.source} onChange={set("source")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {DEAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="deal-pipeline" className="block text-sm mb-1 text-gray-300">Pipeline</label>
              <select id="deal-pipeline" value={form.pipeline} onChange={set("pipeline")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {DEAL_PIPELINES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="deal-description" className="block text-sm mb-1 text-gray-300">Description</label>
            <textarea id="deal-description" value={form.description} onChange={set("description")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Sales information</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="deal-stage" className="block text-sm mb-1 text-gray-300">Stage</label>
              <select id="deal-stage" value={form.stage} onChange={setStage} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {DEAL_STAGES.map((s) => <option key={s} value={s}>{s} ({DEAL_STAGE_PROBABILITY[s]}%)</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="deal-value" className="block text-sm mb-1 text-gray-300">Estimated Value</label>
                <input id="deal-value" type="number" min="0" value={form.value} onChange={set("value")} aria-invalid={!!errors.value}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.value ? "border-red-600" : "border-gray-700"}`} />
              </div>
              <div>
                <label htmlFor="deal-currency" className="block text-sm mb-1 text-gray-300">Currency</label>
                <select id="deal-currency" value={form.currency} onChange={set("currency")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {DEAL_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>
          {errors.value && <p className="text-xs text-red-400 -mt-2">{errors.value}</p>}
          <div className="grid sm:grid-cols-3 gap-4 items-end">
            <div>
              <label htmlFor="deal-probability" className="block text-sm mb-1 text-gray-300">Probability (%)</label>
              <input id="deal-probability" type="number" min="0" max="100" value={form.probability} onChange={set("probability")} aria-invalid={!!errors.probability}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.probability ? "border-red-600" : "border-gray-700"}`} />
              {errors.probability && <p className="text-xs text-red-400 mt-1">{errors.probability}</p>}
            </div>
            <div>
              <label htmlFor="deal-close" className="block text-sm mb-1 text-gray-300">Expected Closing Date</label>
              <input id="deal-close" type="date" value={form.expectedClosingDate} onChange={set("expectedClosingDate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="bg-gray-800/40 rounded-lg px-3 py-2 text-sm">
              <p className="text-xs text-gray-500">Weighted Value</p>
              <p className="font-semibold">{formatMoney(weightedValue, form.currency)}</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="deal-priority" className="block text-sm mb-1 text-gray-300">Priority</label>
              <select id="deal-priority" value={form.priority} onChange={set("priority")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {DEAL_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="deal-health" className="block text-sm mb-1 text-gray-300">Deal Health</label>
              <select id="deal-health" value={form.dealHealth} onChange={set("dealHealth")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {DEAL_HEALTH_STATES.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Ownership</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="deal-owner" className="block text-sm mb-1 text-gray-300">Owner</label>
              <select id="deal-owner" value={form.ownerId} onChange={set("ownerId")} aria-invalid={!!errors.ownerId}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.ownerId ? "border-red-600" : "border-gray-700"}`}>
                <option value="">Unassigned</option>
                {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
              {errors.ownerId && <p className="text-xs text-red-400 mt-1">{errors.ownerId}</p>}
            </div>
            <div>
              <label htmlFor="deal-team" className="block text-sm mb-1 text-gray-300">Team</label>
              <select id="deal-team" value={form.assignedTeam} onChange={set("assignedTeam")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">—</option>
                {["Sales", "Support", "Marketing"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Products and services</legend>
          <p className="text-[11px] text-gray-500">
            Selected from the shared Products &amp; Services catalog — <Link to="/sales/products" className="text-blue-400 hover:underline">manage the catalog</Link>. Archived items can&apos;t be selected here.
          </p>
          <div className="flex gap-2">
            <select value={productPick} onChange={(e) => setProductPick(e.target.value)} className="flex-1 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Select a catalog item (optional)...</option>
              {selectableCatalogItems.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.type}) — {formatMoney(p.standardPrice, p.currency)}</option>)}
            </select>
            <button type="button" onClick={addProductLine} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm whitespace-nowrap">
              <Plus size={14} /> Add Line
            </button>
          </div>
          {errors.lineItems && <p className="text-xs text-red-400">{errors.lineItems}</p>}
          {form.lineItems.length > 0 && (
            <div className="space-y-2">
              {form.lineItems.map((li) => (
                <div key={li._key} className="space-y-1.5">
                  <div className="grid grid-cols-12 gap-2 items-center bg-gray-800/30 rounded-lg p-2">
                    <input value={li.name} onChange={(e) => updateLine(li._key, { name: e.target.value })} placeholder="Name" className="col-span-4 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm" />
                    <input type="number" min="1" value={li.quantity} onChange={(e) => updateLine(li._key, { quantity: e.target.value })} placeholder="Qty" className="col-span-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-center" />
                    <input type="number" min="0" value={li.unitPrice} onChange={(e) => updateLine(li._key, { unitPrice: e.target.value, priceBookId: null })} placeholder="Unit price" className="col-span-2 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm" />
                    <input type="number" min="0" max="100" value={li.discountPercent} onChange={(e) => updateLine(li._key, { discountPercent: e.target.value })} placeholder="Disc %" className="col-span-2 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm" />
                    <select value={li.billingFrequency} onChange={(e) => updateLine(li._key, { billingFrequency: e.target.value })} className="col-span-2 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm">
                      {DEAL_BILLING_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <button type="button" onClick={() => removeLine(li._key)} aria-label={`Remove ${li.name || "line item"}`} className="col-span-1 text-red-400 hover:text-red-300 flex justify-center"><Trash2 size={14} /></button>
                  </div>
                  {li.productId && (
                    <div className="pl-2 flex items-center gap-2 text-xs">
                      {li.priceBookId ? (
                        <span className="text-emerald-400">Priced via <Link to={`/sales/price-books/${li.priceBookId}`} className="hover:underline">a Price Book</Link></span>
                      ) : (
                        <button type="button" onClick={() => checkPriceBook(li)} className="text-blue-400 hover:underline">Check applicable Price Book</button>
                      )}
                      {priceBookCheck?.key === li._key && (
                        <PriceBookCheckPanel result={priceBookCheck.result} onApply={() => applyPriceBookPrice(li._key, priceBookCheck.result)} onDismiss={() => setPriceBookCheck(null)} />
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap justify-end gap-4 text-sm pt-2 border-t border-gray-800">
                <span className="text-gray-400">Subtotal: {formatMoney(totals.subtotal, form.currency)}</span>
                <span className="text-gray-400">Discount: {formatMoney(totals.discountTotal, form.currency)}</span>
                <span className="font-semibold">Estimated Total: {formatMoney(totals.estimatedTotal, form.currency)}</span>
                {totals.recurringValue > 0 && <span className="text-blue-300">Recurring: {formatMoney(totals.recurringValue, form.currency)}</span>}
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Next action</legend>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="deal-next-action" className="block text-sm mb-1 text-gray-300">Next Action</label>
              <input id="deal-next-action" value={form.nextAction} onChange={set("nextAction")} placeholder="e.g. Send proposal follow-up" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="deal-next-type" className="block text-sm mb-1 text-gray-300">Activity Type</label>
              <select id="deal-next-type" value={form.nextActivityType} onChange={set("nextActivityType")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {ACTIVITY_TYPES_FOR_NEXT.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 items-end">
            <div>
              <label htmlFor="deal-next-date" className="block text-sm mb-1 text-gray-300">Activity Date</label>
              <input id="deal-next-date" type="date" value={form.nextActivityDate} onChange={set("nextActivityDate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.reminder} onChange={(e) => setForm((f) => ({ ...f, reminder: e.target.checked }))} />
              Set a reminder
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Additional information</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="deal-competitors" className="block text-sm mb-1 text-gray-300">Competitors (comma separated)</label>
              <input id="deal-competitors" value={form.competitors} onChange={set("competitors")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="deal-tags" className="block text-sm mb-1 text-gray-300">Tags (comma separated)</label>
              <input id="deal-tags" value={form.tags} onChange={set("tags")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label htmlFor="deal-internal-note" className="block text-sm mb-1 text-gray-300">Internal Note</label>
            <textarea id="deal-internal-note" value={form.internalNote} onChange={set("internalNote")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button type="button" onClick={requestClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Deal"}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 -mt-2">
          Preview only — saved to this session's in-memory frontend state. Persistence will be replaced by the backend service adapter in a later phase.
        </p>
      </form>

      {confirmClose && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold">Discard unsaved changes?</h3>
            <p className="text-sm text-gray-400">You have unsaved changes to this deal. Closing now will discard them.</p>
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

// Inline Price Preview result for a single Deal line item — a frontend
// rules preview only, never a backend-confirmed price. Applying it is an
// explicit, visible override of the manually entered unit price.
function PriceBookCheckPanel({ result, onApply, onDismiss }) {
  const resolved = result.winner;
  const finalPrice = resolved ? resolved.finalPrice : result.fallback?.finalPrice;
  const currency = resolved ? resolved.entry.currency : result.fallback?.currency;
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2 flex items-center gap-2 flex-wrap">
      <span className="text-gray-300">{result.reason}</span>
      {finalPrice != null && (
        <>
          <span className="font-medium text-white">{formatMoney(finalPrice, currency)}</span>
          <button type="button" onClick={onApply} className="text-amber-300 hover:underline">Apply (overrides the current unit price)</button>
        </>
      )}
      {result.tied && <span className="flex items-center gap-1 text-red-300"><AlertTriangle size={12} /> Unresolved conflict</span>}
      <button type="button" onClick={onDismiss} className="text-gray-500 hover:text-white ml-auto">Dismiss</button>
    </div>
  );
}
