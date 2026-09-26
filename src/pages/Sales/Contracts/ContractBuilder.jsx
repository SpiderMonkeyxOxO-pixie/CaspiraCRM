import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { X, Plus, Trash2, Copy, ArrowUp, ArrowDown, AlertTriangle, Search } from "lucide-react";
import { createContract, updateContract } from "../../../redux/sales/contractsSlice";
import {
  makeContractLine, computeLineTotal, computeContractTotals, validateContractPayload,
  buildContractFromQuotePreview, buildContractFromOrderPreview, buildContractFromDealPreview,
  buildContractDuplicatePreview, deriveContractType, CONTRACT_TYPES, RENEWAL_TYPES, PAYMENT_TERMS_OPTIONS, BILLING_SCHEDULES, DISCOUNT_TYPES,
} from "../../../Helpers/mockContractData";
import { resolveLinePricing } from "../../../Helpers/mockQuoteData";
import { catalogItems, findCatalogItem, TAX_CATEGORIES, BILLING_INTERVALS } from "../../../Helpers/mockCatalogData";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney } from "./contractUtils";
import ContractDocumentPreview from "./ContractDocumentPreview";

const STEPS = ["Customer", "Products and Services", "Term and Renewal", "Signatories", "Review"];
const randKey = () => Math.random().toString(36).slice(2);

function emptyForm(prefill) {
  const base = {
    companyId: "", contactId: "", dealId: "", ownerId: "", assignedTeam: "Sales",
    currency: "USD", contractType: "One-Time Agreement", lineItems: [],
    effectiveDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    termMonths: 12, renewalType: "Manual Renew", renewalNoticeDays: 60,
    paymentTerms: "Net 30", billingSchedule: "One-time billing", billingContactId: "",
    internalSignatoryName: "", internalSignatoryTitle: "", customerSignatoryName: "", customerSignatoryTitle: "",
    customerNote: "", internalNote: "",
    sourceQuoteId: null, sourceQuoteVersion: null, sourceOrderId: null,
  };
  if (!prefill) return base;
  return {
    ...base,
    companyId: prefill.companyId || "", contactId: prefill.contactId || "", dealId: prefill.dealId || "",
    ownerId: prefill.ownerId || "", assignedTeam: prefill.assignedTeam || "Sales", currency: prefill.currency || "USD",
    paymentTerms: prefill.paymentTerms || "Net 30", billingSchedule: prefill.billingSchedule || "One-time billing",
    billingContactId: prefill.contactId || "", customerNote: prefill.customerNote || "",
    sourceQuoteId: prefill.sourceQuoteId || null, sourceQuoteVersion: prefill.sourceQuoteVersion ?? null, sourceOrderId: prefill.sourceOrderId || null,
    lineItems: (prefill.lineItems || []).map((l) => ({ ...makeContractLine(l), _key: randKey() })),
    contractType: deriveContractType((prefill.lineItems || []).map((l) => makeContractLine(l))),
  };
}
function formFromContract(c) {
  return {
    companyId: c.companyId || "", contactId: c.contactId || "", dealId: c.dealId || "",
    ownerId: c.ownerId || "", assignedTeam: c.assignedTeam || "Sales", currency: c.currency || "USD",
    contractType: c.contractType || "One-Time Agreement",
    lineItems: (c.lineItems || []).map((l) => ({ ...l, _key: l._id || randKey() })),
    effectiveDate: c.effectiveDate ? c.effectiveDate.slice(0, 10) : "", endDate: c.endDate ? c.endDate.slice(0, 10) : "",
    termMonths: c.termMonths ?? 12, renewalType: c.renewalType || "Manual Renew", renewalNoticeDays: c.renewalNoticeDays ?? 60,
    paymentTerms: c.paymentTerms || "Net 30", billingSchedule: c.billingSchedule || "One-time billing", billingContactId: c.billingContactId || "",
    internalSignatoryName: c.signatories?.internal?.name || "", internalSignatoryTitle: c.signatories?.internal?.title || "",
    customerSignatoryName: c.signatories?.customer?.name || "", customerSignatoryTitle: c.signatories?.customer?.title || "",
    customerNote: c.customerNote || "", internalNote: c.internalNote || "",
    sourceQuoteId: c.sourceQuoteId || null, sourceQuoteVersion: c.sourceQuoteVersion ?? null, sourceOrderId: c.sourceOrderId || null,
  };
}

export default function ContractBuilder({ mode, contract, sourceQuoteId, sourceOrderId, sourceDealId, onClose, onSaved }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const isEdit = mode === "edit";
  const isDuplicate = mode === "duplicate";
  const isFromQuote = mode === "fromQuote";
  const isFromOrder = mode === "fromOrder";
  const isFromDeal = mode === "fromDeal";

  const initialSource = useMemo(() => {
    if (isEdit) return contract;
    if (isDuplicate) return buildContractDuplicatePreview(contract._id);
    if (isFromQuote) return buildContractFromQuotePreview(sourceQuoteId);
    if (isFromOrder) return buildContractFromOrderPreview(sourceOrderId);
    if (isFromDeal) return buildContractFromDealPreview(sourceDealId);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [form, setForm] = useState(() => {
    if (isEdit || isDuplicate) return formFromContract(initialSource);
    if (isFromQuote || isFromOrder || isFromDeal) return emptyForm(initialSource);
    return emptyForm(null);
  });
  const initialFormRef = useRef(form);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

  useEffect(() => {
    dispatch(fetchCompanies()); dispatch(fetchContacts()); dispatch(fetchDeals());
  }, [dispatch]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const requestClose = () => (isDirty ? setConfirmClose(true) : onClose());
  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const companyContacts = useMemo(() => allContacts.filter((c) => c.companyId === form.companyId), [allContacts, form.companyId]);
  const companyDeals = useMemo(() => deals.filter((d) => d.companyId === form.companyId), [deals, form.companyId]);

  const addedIds = new Set(form.lineItems.filter((l) => l.catalogItemId).map((l) => l.catalogItemId));
  const searchResults = useMemo(() => {
    if (!itemSearch.trim()) return [];
    const q = itemSearch.trim().toLowerCase();
    return catalogItems.filter((c) => c.status === "Active" && !c.archived && !addedIds.has(c._id) && c.name.toLowerCase().includes(q)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSearch, form.lineItems]);

  const recomputeContractType = (lines) => setForm((f) => ({ ...f, contractType: deriveContractType(lines) }));

  const addCatalogLine = (catalogItemId) => {
    const c = findCatalogItem(catalogItemId);
    if (!c) return;
    const priced = resolveLinePricing({ catalogItemId, priceBookId: null, quantity: 1 });
    const line = makeContractLine({ catalogItemId, quantity: 1, listPriceSnapshot: priced.listPrice, unitPrice: priced.resolvedPrice, order: form.lineItems.length });
    const next = [...form.lineItems, { ...line, _key: randKey() }];
    setForm((f) => ({ ...f, lineItems: next }));
    recomputeContractType(next);
    setItemSearch("");
  };
  const addCustomLine = () => {
    const line = makeContractLine({ name: "New custom line", description: "", unitPrice: 0, quantity: 1, order: form.lineItems.length });
    const next = [...form.lineItems, { ...line, _key: randKey() }];
    setForm((f) => ({ ...f, lineItems: next }));
    recomputeContractType(next);
  };
  const duplicateLine = (key) => {
    const line = form.lineItems.find((l) => l._key === key);
    if (!line) return;
    setForm((f) => ({ ...f, lineItems: [...f.lineItems, { ...line, _key: randKey(), _id: undefined }] }));
  };
  const removeLine = (key) => {
    const next = form.lineItems.filter((l) => l._key !== key);
    setForm((f) => ({ ...f, lineItems: next }));
    recomputeContractType(next);
  };
  const updateLine = (key, changes) => {
    const next = form.lineItems.map((l) => (l._key === key ? { ...l, ...changes } : l));
    setForm((f) => ({ ...f, lineItems: next }));
    if (changes.billingModel) recomputeContractType(next);
  };
  const moveLine = (key, dir) => {
    const idx = form.lineItems.findIndex((l) => l._key === key);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= form.lineItems.length) return;
    const next = [...form.lineItems];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setForm((f) => ({ ...f, lineItems: next.map((l, i) => ({ ...l, order: i })) }));
  };

  const totals = useMemo(() => computeContractTotals(form), [form]);

  const buildPayload = () => ({
    companyId: form.companyId || null, contactId: form.contactId || null, dealId: form.dealId || null,
    ownerId: form.ownerId || null, assignedTeam: form.assignedTeam, currency: form.currency, contractType: form.contractType,
    effectiveDate: form.effectiveDate ? new Date(form.effectiveDate).toISOString() : null,
    endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
    termMonths: Number(form.termMonths) || null, renewalType: form.renewalType, renewalNoticeDays: Number(form.renewalNoticeDays) || 60,
    paymentTerms: form.paymentTerms, billingSchedule: form.billingSchedule, billingContactId: form.billingContactId || form.contactId || null,
    signatories: {
      internal: { name: form.internalSignatoryName || null, title: form.internalSignatoryTitle || null, signedAt: null },
      customer: { name: form.customerSignatoryName || null, title: form.customerSignatoryTitle || null, signedAt: null },
    },
    customerNote: form.customerNote, internalNote: form.internalNote,
    sourceQuoteId: form.sourceQuoteId, sourceQuoteVersion: form.sourceQuoteVersion, sourceOrderId: form.sourceOrderId,
    lineItems: form.lineItems.map((l) => ({
      catalogItemId: l.catalogItemId || null, isCustomLine: !l.catalogItemId, name: l.name, description: l.description || "",
      unit: l.unit || "Each", billingModel: l.billingModel || "One Time", billingInterval: l.billingInterval || null,
      quantity: Number(l.quantity) || 1, listPriceSnapshot: l.listPriceSnapshot ?? null, priceBookIdUsed: l.priceBookIdUsed || null,
      priceBookPriceSnapshot: l.priceBookPriceSnapshot ?? null, unitPrice: Number(l.unitPrice) || 0,
      discountType: l.discountType || null, discountValue: l.discountValue === "" ? null : l.discountValue, taxCategory: l.taxCategory || "Standard",
    })),
  });

  const jumpToFirstErrorStep = (errs) => {
    const keys = Object.keys(errs);
    if (keys.some((k) => ["companyId", "contactId", "currency"].includes(k))) return setStep(0);
    if (keys.some((k) => k.startsWith("line") || k === "lineItems")) return setStep(1);
    if (keys.some((k) => ["effectiveDate", "endDate", "renewalType"].includes(k))) return setStep(2);
    if (keys.some((k) => ["billingContactId", "paymentTerms"].includes(k))) return setStep(2);
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    const payload = buildPayload();
    const { errors: valErrors } = validateContractPayload(payload);
    if (Object.keys(valErrors).length > 0) {
      setErrors(valErrors);
      jumpToFirstErrorStep(valErrors);
      setSaving(false);
      return;
    }

    let result;
    if (isEdit) result = await dispatch(updateContract({ id: contract._id, changes: payload }));
    else result = await dispatch(createContract(payload));
    setSaving(false);

    const fulfilled = isEdit ? updateContract.fulfilled.match(result) : createContract.fulfilled.match(result);
    if (!fulfilled) {
      const errs = result.payload?.errors || {};
      setErrors(errs);
      jumpToFirstErrorStep(errs);
      return;
    }
    const saved = result.payload;
    initialFormRef.current = form;
    onSaved?.(saved);
    navigate(`/sales/contracts/${saved._id}`);
    onClose();
  };

  const title = isEdit ? "Edit Draft Contract" : isDuplicate ? "Duplicate Contract" : isFromQuote ? "Prepare Contract from Quote" : isFromOrder ? "Generate Contract from Order" : isFromDeal ? "Generate Contract from Won Deal" : "Create Manual Contract";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={requestClose} />
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={title} className="relative bg-[#0d0f16] border border-gray-800 rounded-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={requestClose} aria-label="Close"><X size={20} className="text-gray-400 hover:text-white" /></button>
        </div>

        <nav aria-label="Contract builder steps" className="flex flex-col md:flex-row gap-1 px-6 py-3 border-b border-gray-800 max-h-40 md:max-h-none overflow-y-auto md:overflow-visible">
          {STEPS.map((label, i) => (
            <button key={label} onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined}
              className={`text-left md:text-center px-3 py-2 rounded-lg text-sm ${step === i ? "bg-blue-500/20 text-blue-300" : i < step ? "text-gray-300 hover:bg-gray-800" : "text-gray-500 hover:bg-gray-800"}`}>
              {i + 1} {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
              <Field label="Company" required error={errors.companyId}>
                <select value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, contactId: "", dealId: "" }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select a Company</option>
                  {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Primary Contact" error={errors.contactId}>
                <select value={form.contactId} onChange={set("contactId")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">No contact</option>
                  {companyContacts.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Related Deal">
                <select value={form.dealId} onChange={set("dealId")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">No deal</option>
                  {companyDeals.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Currency" required error={errors.currency}>
                <select value={form.currency} onChange={set("currency")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  {["USD", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Contract Type">
                <select value={form.contractType} onChange={set("contractType")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  {CONTRACT_TYPES.filter((t) => t !== "Amendment").map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search catalog to add a line..." className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white" />
                {searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                    {searchResults.map((c) => (
                      <button key={c._id} onClick={() => addCatalogLine(c._id)} className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 flex justify-between">
                        <span>{c.name}</span><span className="text-gray-500">{formatMoney(c.standardPrice, form.currency)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={addCustomLine} className="flex items-center gap-1.5 text-sm text-blue-400 hover:underline"><Plus size={14} /> Add custom descriptive line</button>

              {errors.lineItems && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle size={12} /> {errors.lineItems}</p>}

              <div className="space-y-3">
                {form.lineItems.map((l, idx) => (
                  <div key={l._key} className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <input value={l.name} onChange={(e) => updateLine(l._key, { name: e.target.value })} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => moveLine(l._key, -1)} disabled={idx === 0} aria-label="Move up" className="text-gray-500 hover:text-white disabled:opacity-30"><ArrowUp size={14} /></button>
                        <button onClick={() => moveLine(l._key, 1)} disabled={idx === form.lineItems.length - 1} aria-label="Move down" className="text-gray-500 hover:text-white disabled:opacity-30"><ArrowDown size={14} /></button>
                        <button onClick={() => duplicateLine(l._key)} aria-label="Duplicate line" className="text-gray-500 hover:text-white"><Copy size={14} /></button>
                        <button onClick={() => removeLine(l._key)} aria-label="Remove line" className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                      <label className="flex flex-col gap-1">Qty
                        <input type="number" min="1" value={l.quantity} onChange={(e) => updateLine(l._key, { quantity: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white" />
                        {errors[`line_${idx}_quantity`] && <span className="text-red-400">{errors[`line_${idx}_quantity`]}</span>}
                      </label>
                      <label className="flex flex-col gap-1">Unit Price
                        <input type="number" value={l.unitPrice} onChange={(e) => updateLine(l._key, { unitPrice: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white" />
                        {errors[`line_${idx}_price`] && <span className="text-red-400">{errors[`line_${idx}_price`]}</span>}
                      </label>
                      <label className="flex flex-col gap-1">Billing Model
                        <select value={l.billingModel} onChange={(e) => updateLine(l._key, { billingModel: e.target.value, billingInterval: e.target.value === "Recurring" ? (l.billingInterval || "Monthly") : null })} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white">
                          <option value="One Time">One Time</option>
                          <option value="Recurring">Recurring</option>
                        </select>
                      </label>
                      {l.billingModel === "Recurring" && (
                        <label className="flex flex-col gap-1">Interval
                          <select value={l.billingInterval || "Monthly"} onChange={(e) => updateLine(l._key, { billingInterval: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white">
                            {BILLING_INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
                          </select>
                          {errors[`line_${idx}_interval`] && <span className="text-red-400">{errors[`line_${idx}_interval`]}</span>}
                        </label>
                      )}
                      <label className="flex flex-col gap-1">Discount
                        <div className="flex gap-1">
                          <select value={l.discountType || ""} onChange={(e) => updateLine(l._key, { discountType: e.target.value || null })} className="bg-gray-800 border border-gray-700 rounded px-1 py-1 text-white w-1/2">
                            <option value="">None</option>
                            {DISCOUNT_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                          {l.discountType && <input type="number" value={l.discountValue || ""} onChange={(e) => updateLine(l._key, { discountValue: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-1 py-1 text-white w-1/2" />}
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">Tax Category
                        <select value={l.taxCategory} onChange={(e) => updateLine(l._key, { taxCategory: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white">
                          {TAX_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                    </div>
                    <p className="text-xs text-gray-400 text-right">Line total: {formatMoney(computeLineTotal(l), form.currency)}</p>
                  </div>
                ))}
                {form.lineItems.length === 0 && <p className="text-sm text-gray-500 text-center py-8">No line items yet — search the catalog or add a custom line above.</p>}
              </div>
              <p className="text-xs text-gray-500">Contract type: <span className="text-gray-300">{form.contractType}</span> (derived from line billing models)</p>
            </div>
          )}

          {step === 2 && (
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
              <Field label="Effective (start) date" required error={errors.effectiveDate}>
                <input type="date" value={form.effectiveDate} onChange={set("effectiveDate")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </Field>
              <Field label="End date" required error={errors.endDate}>
                <input type="date" value={form.endDate} onChange={set("endDate")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </Field>
              <Field label="Term (months)">
                <input type="number" min="1" value={form.termMonths} onChange={set("termMonths")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </Field>
              <Field label="Renewal type" required error={errors.renewalType}>
                <select value={form.renewalType} onChange={set("renewalType")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  {RENEWAL_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              {form.renewalType !== "No Renewal" && (
                <Field label="Renewal notice (days)">
                  <input type="number" min="0" value={form.renewalNoticeDays} onChange={set("renewalNoticeDays")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </Field>
              )}
              <Field label="Payment terms" required error={errors.paymentTerms}>
                <select value={form.paymentTerms} onChange={set("paymentTerms")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  {PAYMENT_TERMS_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Billing schedule">
                <select value={form.billingSchedule} onChange={set("billingSchedule")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  {BILLING_SCHEDULES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Billing contact" error={errors.billingContactId}>
                <select value={form.billingContactId} onChange={set("billingContactId")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Same as primary contact</option>
                  {companyContacts.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Internal signatory</h3>
                <Field label="Name"><input value={form.internalSignatoryName} onChange={set("internalSignatoryName")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" /></Field>
                <Field label="Title"><input value={form.internalSignatoryTitle} onChange={set("internalSignatoryTitle")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" /></Field>
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Customer signatory</h3>
                <Field label="Name"><input value={form.customerSignatoryName} onChange={set("customerSignatoryName")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" /></Field>
                <Field label="Title"><input value={form.customerSignatoryTitle} onChange={set("customerSignatoryTitle")} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" /></Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Customer note"><textarea value={form.customerNote} onChange={set("customerNote")} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" /></Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Internal note"><textarea value={form.internalNote} onChange={set("internalNote")} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" /></Field>
              </div>
              <p className="md:col-span-2 text-xs text-gray-500">Names entered here are pre-filled; actual signature dates are recorded later via the Contract's Send for Signature / Record Signature actions.</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 text-sm">
                <p className="font-semibold text-white mb-2">Review summary</p>
                <p className="text-gray-400">One-time: {formatMoney(totals.oneTimeTotal, form.currency)} · Recurring: {formatMoney(totals.recurringTotal, form.currency)} · Tax: {formatMoney(totals.tax, form.currency)} · <span className="text-white font-medium">Grand total: {formatMoney(totals.grandTotal, form.currency)}</span></p>
                <p className="text-gray-500 mt-2">The contract is saved as a Draft. It becomes binding only after both parties have signed it.</p>
              </div>
              <ContractDocumentPreview
                contract={{ ...form, contractNumber: "CTR-PREVIEW-DRAFT", signatories: { internal: { name: form.internalSignatoryName }, customer: { name: form.customerSignatoryName } } }}
                company={companies.find((c) => c._id === form.companyId)}
                contact={allContacts.find((c) => c._id === form.contactId)}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="text-sm text-gray-400 disabled:opacity-30 hover:text-white">Back</button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">Next</button>
          ) : (
            <button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">{saving ? "Saving…" : isEdit ? "Save Changes" : "Save Frontend Draft"}</button>
          )}
        </div>
      </div>

      {confirmClose && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Discard changes">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmClose(false)} />
          <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-sm p-6">
            <p className="text-white font-semibold mb-2">Discard unsaved changes?</p>
            <p className="text-sm text-gray-400 mb-4">You have unsaved changes in this Contract draft.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmClose(false)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Keep editing</button>
              <button onClick={onClose} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg">Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}{required && <span className="text-red-400"> *</span>}</label>
      {children}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}
