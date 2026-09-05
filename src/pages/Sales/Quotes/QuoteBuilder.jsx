import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { X, Plus, Trash2, Copy, ArrowUp, ArrowDown, AlertTriangle, Check, Search } from "lucide-react";
import {
  createQuote, updateQuote, createNewVersion, submitForReview,
  PAYMENT_TERMS_OPTIONS, BILLING_SCHEDULES, DOCUMENT_LAYOUTS,
} from "../../../redux/sales/quotesSlice";
import {
  makeLineItem, computeLineTotal, computeQuoteTotals, computeQuoteWarnings,
  validateQuotePayload, resolveLinePricing, buildNewVersionPreview, buildQuoteDuplicatePreview,
  DISCOUNT_TYPES,
} from "../../../Helpers/mockQuoteData";
import { catalogItems, findCatalogItem, TAX_CATEGORIES, BILLING_INTERVALS } from "../../../Helpers/mockCatalogData";
import { getEffectiveStatus as getPriceBookEffectiveStatus } from "../../../Helpers/mockPriceBookData";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchPriceBooks } from "../../../redux/sales/priceBooksSlice";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney } from "./quoteUtils";
import QuoteDocumentPreview from "./QuoteDocumentPreview";

const STEPS = ["Customer and Deal", "Products and Pricing", "Commercial Terms", "Document", "Review"];
const randKey = () => Math.random().toString(36).slice(2);
const daysFromNowStr = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function emptyForm(prefillDealId) {
  return {
    companyId: "", primaryContactId: "", dealId: prefillDealId || "", title: "", ownerId: "", assignedTeam: "Sales",
    currency: "USD", priceBookId: "", issueDate: new Date().toISOString().slice(0, 10), validUntilDate: daysFromNowStr(30),
    lineItems: [], overallDiscountType: "", overallDiscountValue: "",
    paymentTerms: "Net 30", billingSchedule: "One-time billing", serviceStartEstimate: "", deliveryEstimate: "",
    minimumCommitment: "", renewalSummary: "", customerNote: "", internalNote: "",
    termsAndConditions: "Standard preview terms and conditions apply. This is a frontend preview document only.",
    assumptions: "", exclusions: "", documentLayout: "Standard", changeSummary: "",
  };
}
function formFromQuote(q) {
  return {
    companyId: q.companyId || "", primaryContactId: q.primaryContactId || "", dealId: q.dealId || "", title: q.title || "",
    ownerId: q.ownerId || "", assignedTeam: q.assignedTeam || "Sales", currency: q.currency || "USD", priceBookId: q.priceBookId || "",
    issueDate: q.issueDate ? q.issueDate.slice(0, 10) : "", validUntilDate: q.validUntilDate ? q.validUntilDate.slice(0, 10) : "",
    lineItems: (q.lineItems || []).map((l) => ({ ...l, _key: l._id || randKey() })),
    overallDiscountType: q.overallDiscountType || "", overallDiscountValue: q.overallDiscountValue ?? "",
    paymentTerms: q.paymentTerms || "Net 30", billingSchedule: q.billingSchedule || "One-time billing",
    serviceStartEstimate: q.serviceStartEstimate || "", deliveryEstimate: q.deliveryEstimate || "",
    minimumCommitment: q.minimumCommitment || "", renewalSummary: q.renewalSummary || "",
    customerNote: q.customerNote || "", internalNote: q.internalNote || "",
    termsAndConditions: q.termsAndConditions || "", assumptions: q.assumptions || "", exclusions: q.exclusions || "",
    documentLayout: q.documentLayout || "Standard", changeSummary: q.changeSummary || "",
  };
}

function suggestPriceBook(priceBooksList, companyId, currency) {
  const candidates = priceBooksList.filter((pb) => pb.currency === currency && getPriceBookEffectiveStatus(pb) === "Active");
  const companySpecific = candidates.find((pb) => (pb.companyIds || []).includes(companyId));
  if (companySpecific) return companySpecific;
  return candidates.find((pb) => pb.code === "PB-STANDARD") || candidates[0] || null;
}

export default function QuoteBuilder({ mode, quote, prefillDealId, onClose, onSaved }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const priceBooksList = useSelector((s) => s.priceBooks.items);
  const isEdit = mode === "edit";
  const isNewVersion = mode === "newVersion";
  const isDuplicate = mode === "duplicate";

  const initialSource = useMemo(() => {
    if (isNewVersion) return buildNewVersionPreview(quote._id);
    if (isDuplicate) return buildQuoteDuplicatePreview(quote._id);
    return quote;
  }, [isNewVersion, isDuplicate, quote]);

  const [form, setForm] = useState(() => (isEdit || isNewVersion || isDuplicate ? formFromQuote(initialSource) : emptyForm(prefillDealId)));
  const initialFormRef = useRef(form);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [dealSuggestion, setDealSuggestion] = useState(null);
  const [overridingKey, setOverridingKey] = useState(null);

  useEffect(() => {
    dispatch(fetchCompanies()); dispatch(fetchContacts()); dispatch(fetchDeals()); dispatch(fetchPriceBooks());
  }, [dispatch]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const requestClose = () => (isDirty ? setConfirmClose(true) : onClose());
  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const companyContacts = useMemo(() => allContacts.filter((c) => c.companyId === form.companyId), [allContacts, form.companyId]);
  const companyDeals = useMemo(() => deals.filter((d) => d.companyId === form.companyId), [deals, form.companyId]);
  const selectedDeal = deals.find((d) => d._id === form.dealId);

  // Deal prefill — computed as a SUGGESTION only; never silently applied.
  useEffect(() => {
    if (!form.dealId) { setDealSuggestion(null); return; }
    const deal = deals.find((d) => d._id === form.dealId);
    if (!deal) return;
    const suggestedLineItems = (deal.lineItems || []).filter((li) => li.productId).map((li) => {
      const catalogItem = findCatalogItem(li.productId);
      return makeLineItem({ catalogItemId: li.productId, quantity: li.quantity, unitPrice: li.unitPrice, name: catalogItem?.name || li.name });
    });
    const suggestedPb = suggestPriceBook(priceBooksList, deal.companyId, deal.currency || form.currency);
    setDealSuggestion({
      deal, suggestedCompanyId: deal.companyId, suggestedContactIds: [deal.primaryContactId, ...(deal.additionalContactIds || [])].filter(Boolean),
      suggestedCurrency: deal.currency, suggestedLineItems, suggestedPriceBookId: suggestedPb?._id || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.dealId]);

  const applyDealPrefill = () => {
    if (!dealSuggestion) return;
    setForm((f) => ({
      ...f,
      companyId: f.companyId || dealSuggestion.suggestedCompanyId,
      primaryContactId: f.primaryContactId || dealSuggestion.suggestedContactIds[0] || "",
      currency: dealSuggestion.suggestedCurrency || f.currency,
      priceBookId: f.priceBookId || dealSuggestion.suggestedPriceBookId || "",
      lineItems: f.lineItems.length ? f.lineItems : dealSuggestion.suggestedLineItems.map((l) => ({ ...l, _key: randKey() })),
      title: f.title || `Quote for ${dealSuggestion.deal.name}`,
    }));
    setDealSuggestion(null);
  };

  // --- Line item management ---
  const addedIds = new Set(form.lineItems.filter((l) => l.catalogItemId).map((l) => l.catalogItemId));
  const searchResults = useMemo(() => {
    if (!itemSearch.trim()) return [];
    const q = itemSearch.trim().toLowerCase();
    return catalogItems.filter((c) => c.status === "Active" && !c.archived && !addedIds.has(c._id) && c.name.toLowerCase().includes(q)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSearch, form.lineItems]);

  const addCatalogLine = (catalogItemId, included = true) => {
    const c = findCatalogItem(catalogItemId);
    if (!c) return;
    const priced = resolveLinePricing({ catalogItemId, priceBookId: form.priceBookId || null, quantity: 1 });
    const line = makeLineItem({
      catalogItemId, quantity: 1, listPrice: priced.listPrice, priceBookPrice: priced.priceBookPrice,
      priceBookIdUsed: priced.priceBookIdUsed, unitPrice: priced.resolvedPrice, included, order: form.lineItems.length,
    });
    setForm((f) => ({ ...f, lineItems: [...f.lineItems, { ...line, _key: randKey() }] }));
    setItemSearch("");
  };
  const addCustomLine = (included = true) => {
    const line = makeLineItem({ name: "New custom line", description: "", unitPrice: 0, quantity: 1, included, order: form.lineItems.length });
    setForm((f) => ({ ...f, lineItems: [...f.lineItems, { ...line, _key: randKey() }] }));
  };
  const duplicateLine = (key) => {
    const line = form.lineItems.find((l) => l._key === key);
    if (!line) return;
    setForm((f) => ({ ...f, lineItems: [...f.lineItems, { ...line, _key: randKey(), _id: undefined }] }));
  };
  const removeLine = (key) => setForm((f) => ({ ...f, lineItems: f.lineItems.filter((l) => l._key !== key) }));
  const updateLine = (key, changes) => setForm((f) => ({ ...f, lineItems: f.lineItems.map((l) => (l._key === key ? { ...l, ...changes } : l)) }));
  const moveLine = (key, dir) => {
    const idx = form.lineItems.findIndex((l) => l._key === key);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= form.lineItems.length) return;
    const next = [...form.lineItems];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setForm((f) => ({ ...f, lineItems: next.map((l, i) => ({ ...l, order: i })) }));
  };

  const applyOverride = (key, newPrice, reason) => {
    updateLine(key, { unitPrice: Number(newPrice), isOverridden: true, overrideReason: reason });
    setOverridingKey(null);
  };
  const revertOverride = (key, line) => {
    const priced = resolveLinePricing({ catalogItemId: line.catalogItemId, priceBookId: form.priceBookId || null, quantity: line.quantity });
    updateLine(key, { unitPrice: priced.resolvedPrice, isOverridden: false, overrideReason: "", listPrice: priced.listPrice, priceBookPrice: priced.priceBookPrice, priceBookIdUsed: priced.priceBookIdUsed });
  };

  const totals = useMemo(() => computeQuoteTotals(form), [form]);
  const warnings = useMemo(() => computeQuoteWarnings(form), [form]);

  const buildPayload = () => ({
    companyId: form.companyId || null, primaryContactId: form.primaryContactId || null, dealId: form.dealId || null,
    title: form.title.trim(), ownerId: form.ownerId || null, assignedTeam: form.assignedTeam,
    currency: form.currency, priceBookId: form.priceBookId || null,
    issueDate: form.issueDate ? new Date(form.issueDate).toISOString() : null,
    validUntilDate: form.validUntilDate ? new Date(form.validUntilDate).toISOString() : null,
    lineItems: form.lineItems.map((l) => ({
      catalogItemId: l.catalogItemId || null, isCustomLine: !l.catalogItemId, sectionTitle: l.sectionTitle || null, order: l.order ?? 0,
      name: l.name, description: l.description || "", unit: l.unit || "Each", billingModel: l.billingModel || "One Time",
      billingInterval: l.billingInterval || null, quantity: Number(l.quantity) || 1,
      listPrice: l.listPrice ?? null, priceBookPrice: l.priceBookPrice ?? null, priceBookIdUsed: l.priceBookIdUsed || null,
      unitPrice: Number(l.unitPrice) || 0, isOverridden: !!l.isOverridden, overrideReason: l.overrideReason || "",
      discountType: l.discountType || null, discountValue: l.discountValue === "" ? null : l.discountValue,
      taxCategory: l.taxCategory || "Standard", included: l.included !== false,
    })),
    overallDiscountType: form.overallDiscountType || null, overallDiscountValue: form.overallDiscountValue === "" ? null : Number(form.overallDiscountValue),
    paymentTerms: form.paymentTerms, billingSchedule: form.billingSchedule, serviceStartEstimate: form.serviceStartEstimate,
    deliveryEstimate: form.deliveryEstimate, minimumCommitment: form.minimumCommitment, renewalSummary: form.renewalSummary,
    customerNote: form.customerNote, internalNote: form.internalNote, termsAndConditions: form.termsAndConditions,
    assumptions: form.assumptions, exclusions: form.exclusions, documentLayout: form.documentLayout,
    changeSummary: form.changeSummary,
  });

  const jumpToFirstErrorStep = (errs) => {
    const keys = Object.keys(errs);
    if (keys.some((k) => ["companyId", "primaryContactId", "title", "currency", "priceBookId", "validUntilDate"].includes(k))) return setStep(0);
    if (keys.some((k) => k.startsWith("line") || k === "lineItems")) return setStep(1);
    if (keys.includes("termsAndConditions")) return setStep(2);
  };

  const save = async (forSubmit) => {
    setSaving(true);
    setErrors({});
    const payload = buildPayload();
    if (isNewVersion && !payload.changeSummary?.trim()) {
      setErrors({ changeSummary: "A change summary is required for a new version" });
      setSaving(false);
      setStep(4);
      return;
    }
    const { errors: valErrors } = validateQuotePayload(payload, { forSubmit });
    if (Object.keys(valErrors).length > 0) {
      setErrors(valErrors);
      jumpToFirstErrorStep(valErrors);
      setSaving(false);
      return;
    }

    let result;
    if (isNewVersion) result = await dispatch(createNewVersion({ id: quote._id, payload }));
    else if (isEdit) result = await dispatch(updateQuote({ id: quote._id, changes: payload }));
    else result = await dispatch(createQuote(payload));
    setSaving(false);

    const fulfilled = isNewVersion ? createNewVersion.fulfilled.match(result) : isEdit ? updateQuote.fulfilled.match(result) : createQuote.fulfilled.match(result);
    if (!fulfilled) {
      const errs = result.payload?.errors || {};
      setErrors(errs);
      jumpToFirstErrorStep(errs);
      return;
    }
    const savedQuote = isNewVersion ? result.payload.quote : result.payload;
    if (forSubmit) await dispatch(submitForReview(savedQuote._id));
    initialFormRef.current = form;
    onSaved?.(savedQuote);
    navigate(`/sales/quotes/${savedQuote._id}`);
    onClose();
  };

  const title = isNewVersion ? `New Version — ${quote.quoteNumber}` : isEdit ? `Edit Draft — ${quote.quoteNumber}` : isDuplicate ? `Duplicate — ${quote.quoteNumber}` : "Create Quote";

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col text-white" role="dialog" aria-modal="true" aria-label={title} ref={containerRef}>
      <div className="flex justify-between items-center px-4 sm:px-8 py-4 border-b border-gray-800 bg-gray-950">
        <h1 className="text-lg font-bold">{title}</h1>
        <button onClick={requestClose} aria-label="Close"><X size={22} /></button>
      </div>

      <nav aria-label="Quote builder steps" className="flex flex-col sm:flex-row gap-1 px-4 sm:px-8 py-2 border-b border-gray-800 bg-gray-950 overflow-x-auto">
        {STEPS.map((label, idx) => (
          <button key={label} type="button" onClick={() => setStep(idx)} aria-current={step === idx ? "step" : undefined}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm sm:rounded-lg ${step === idx ? "bg-blue-700 text-white" : "text-gray-400 hover:text-white hover:bg-gray-900"}`}>
            <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[11px] shrink-0">{idx + 1}</span>
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        <div className="max-w-5xl mx-auto space-y-6">

          {dealSuggestion && (
            <div className="bg-blue-900/15 border border-blue-800/30 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-blue-100">This Deal has default customer, currency, Price Book and product information available to prefill.</p>
              <div className="flex gap-2">
                <button onClick={applyDealPrefill} className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm">Apply Deal Prefill</button>
                <button onClick={() => setDealSuggestion(null)} className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm">Dismiss</button>
              </div>
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Customer and Deal</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="q-company" className="block text-sm mb-1 text-gray-300">Company</label>
                  <select id="q-company" value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, primaryContactId: "" }))}
                    aria-invalid={!!errors.companyId} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.companyId ? "border-red-600" : "border-gray-700"}`}>
                    <option value="">Select a company...</option>
                    {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                  {errors.companyId && <p className="text-xs text-red-400 mt-1">{errors.companyId}</p>}
                </div>
                <div>
                  <label htmlFor="q-contact" className="block text-sm mb-1 text-gray-300">Primary Contact</label>
                  <select id="q-contact" value={form.primaryContactId} onChange={set("primaryContactId")} disabled={!form.companyId} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                    <option value="">{form.companyId ? "Select a contact..." : "Select a company first"}</option>
                    {companyContacts.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                  {errors.primaryContactId && <p className="text-xs text-amber-400 mt-1">{errors.primaryContactId}</p>}
                </div>
              </div>
              <div>
                <label htmlFor="q-deal" className="block text-sm mb-1 text-gray-300">Related Deal</label>
                <select id="q-deal" value={form.dealId} onChange={set("dealId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">No related Deal</option>
                  {(form.companyId ? companyDeals : deals).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                </select>
                {selectedDeal && <p className="text-xs text-gray-500 mt-1">{selectedDeal.stage} · {formatMoney(selectedDeal.value, selectedDeal.currency)}</p>}
              </div>
              <div>
                <label htmlFor="q-title" className="block text-sm mb-1 text-gray-300">Quote Title</label>
                <input id="q-title" value={form.title} onChange={set("title")} aria-invalid={!!errors.title}
                  className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.title ? "border-red-600" : "border-gray-700"}`} />
                {errors.title && <p className="text-xs text-red-400 mt-1">{errors.title}</p>}
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="q-owner" className="block text-sm mb-1 text-gray-300">Owner</label>
                  <select id="q-owner" value={form.ownerId} onChange={set("ownerId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="q-team" className="block text-sm mb-1 text-gray-300">Team</label>
                  <select id="q-team" value={form.assignedTeam} onChange={set("assignedTeam")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    {["Sales", "Support", "Marketing"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="q-currency" className="block text-sm mb-1 text-gray-300">Currency</label>
                  <select id="q-currency" value={form.currency} onChange={set("currency")} aria-invalid={!!errors.currency} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.currency ? "border-red-600" : "border-gray-700"}`}>
                    {["USD", "EUR", "GBP", "INR", "IDR"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="q-pricebook" className="block text-sm mb-1 text-gray-300">Price Book</label>
                  <select id="q-pricebook" value={form.priceBookId} onChange={set("priceBookId")} aria-invalid={!!errors.priceBookId} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.priceBookId ? "border-red-600" : "border-gray-700"}`}>
                    <option value="">No Price Book (standard catalog pricing)</option>
                    {priceBooksList.filter((pb) => getPriceBookEffectiveStatus(pb) === "Active").map((pb) => <option key={pb._id} value={pb._id}>{pb.name} ({pb.currency})</option>)}
                  </select>
                  {errors.priceBookId && <p className="text-xs text-red-400 mt-1">{errors.priceBookId}</p>}
                </div>
                <div>
                  <label htmlFor="q-issue" className="block text-sm mb-1 text-gray-300">Issue Date</label>
                  <input id="q-issue" type="date" value={form.issueDate} onChange={set("issueDate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="q-valid" className="block text-sm mb-1 text-gray-300">Valid Until</label>
                  <input id="q-valid" type="date" value={form.validUntilDate} onChange={set("validUntilDate")} aria-invalid={!!errors.validUntilDate} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.validUntilDate ? "border-red-600" : "border-gray-700"}`} />
                  {errors.validUntilDate && <p className="text-xs text-red-400 mt-1">{errors.validUntilDate}</p>}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Products and Pricing</h2>
              <div className="flex gap-2 flex-wrap items-end">
                <div className="flex-1 min-w-52 relative">
                  <label htmlFor="q-item-search" className="block text-sm mb-1 text-gray-300">Add a Product or Service</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input id="q-item-search" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search the catalog..." className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm" />
                  </div>
                  {searchResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full border border-gray-800 rounded-lg divide-y divide-gray-800 bg-gray-900 max-h-48 overflow-y-auto shadow-xl">
                      {searchResults.map((c) => (
                        <button key={c._id} type="button" onClick={() => addCatalogLine(c._id)} className="w-full text-left flex justify-between items-center px-3 py-2 text-sm hover:bg-gray-800">
                          <span>{c.name} <span className="text-gray-500 text-xs">({c.type})</span></span><Plus size={14} className="text-blue-400" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => addCustomLine(true)} className="px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm whitespace-nowrap">+ Custom Line</button>
                <button type="button" onClick={() => addCustomLine(false)} className="px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm whitespace-nowrap">+ Optional Line</button>
              </div>
              {errors.lineItems && <p className="text-xs text-red-400">{errors.lineItems}</p>}

              <div className="space-y-3">
                {form.lineItems.length === 0 ? (
                  <p className="text-sm text-gray-500">No line items yet — search the catalog above or add a custom line.</p>
                ) : form.lineItems.map((line, idx) => (
                  <LineItemCard
                    key={line._key} line={line} idx={idx} total={form.lineItems.length} currency={form.currency}
                    errors={errors} overridingKey={overridingKey} setOverridingKey={setOverridingKey}
                    onUpdate={(changes) => updateLine(line._key, changes)}
                    onRemove={() => removeLine(line._key)} onDuplicate={() => duplicateLine(line._key)}
                    onMove={(dir) => moveLine(line._key, dir)} onOverride={(price, reason) => applyOverride(line._key, price, reason)}
                    onRevert={() => revertOverride(line._key, line)}
                  />
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-4 border-t border-gray-800 pt-4">
                <div>
                  <label className="block text-sm mb-1 text-gray-300">Overall Discount</label>
                  <div className="flex gap-2">
                    <select value={form.overallDiscountType} onChange={set("overallDiscountType")} className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                      <option value="">None</option>
                      {DISCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input type="number" min="0" value={form.overallDiscountValue} onChange={set("overallDiscountValue")} disabled={!form.overallDiscountType} placeholder="Value" className="flex-1 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm disabled:opacity-50" />
                  </div>
                </div>
                <div className="bg-gray-800/40 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>{formatMoney(totals.subtotal, form.currency)}</span></div>
                  {totals.overallDiscountAmount > 0 && <div className="flex justify-between text-gray-400"><span>Overall Discount</span><span>-{formatMoney(totals.overallDiscountAmount, form.currency)}</span></div>}
                  <div className="flex justify-between text-gray-400"><span>Tax (preview)</span><span>{formatMoney(totals.tax, form.currency)}</span></div>
                  <div className="flex justify-between font-semibold pt-1 border-t border-gray-700"><span>Grand Total</span><span>{formatMoney(totals.grandTotal, form.currency)}</span></div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-gray-500 pt-1">
                    {totals.oneTimeTotal > 0 && <span>One-time: {formatMoney(totals.oneTimeTotal, form.currency)}</span>}
                    {totals.monthlyRecurringTotal > 0 && <span>Monthly: {formatMoney(totals.monthlyRecurringTotal, form.currency)}</span>}
                    {totals.annualRecurringTotal > 0 && <span>Annual: {formatMoney(totals.annualRecurringTotal, form.currency)}</span>}
                    {totals.usageBasedEstimate > 0 && <span>Usage: {formatMoney(totals.usageBasedEstimate, form.currency)}</span>}
                  </div>
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 space-y-1">
                  <p className="font-medium flex items-center gap-1.5"><AlertTriangle size={13} /> Frontend pricing warnings (preview only — not backend-enforced):</p>
                  <ul className="list-disc list-inside">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Commercial Terms</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="q-payment" className="block text-sm mb-1 text-gray-300">Payment Terms</label>
                  <select id="q-payment" value={form.paymentTerms} onChange={set("paymentTerms")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    {PAYMENT_TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="q-billing" className="block text-sm mb-1 text-gray-300">Billing Schedule</label>
                  <select id="q-billing" value={form.billingSchedule} onChange={set("billingSchedule")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    {BILLING_SCHEDULES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label htmlFor="q-start" className="block text-sm mb-1 text-gray-300">Service-Start Estimate</label><input id="q-start" value={form.serviceStartEstimate} onChange={set("serviceStartEstimate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label htmlFor="q-delivery" className="block text-sm mb-1 text-gray-300">Delivery Estimate</label><input id="q-delivery" value={form.deliveryEstimate} onChange={set("deliveryEstimate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label htmlFor="q-commitment" className="block text-sm mb-1 text-gray-300">Minimum Commitment</label><input id="q-commitment" value={form.minimumCommitment} onChange={set("minimumCommitment")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label htmlFor="q-renewal" className="block text-sm mb-1 text-gray-300">Renewal Summary</label><input id="q-renewal" value={form.renewalSummary} onChange={set("renewalSummary")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div className="bg-blue-900/10 border border-blue-800/30 rounded-lg p-3">
                <label htmlFor="q-customer-note" className="block text-sm mb-1 text-blue-200">Customer Note (visible on the customer document)</label>
                <textarea id="q-customer-note" value={form.customerNote} onChange={set("customerNote")} rows={2} className="w-full bg-gray-900/60 border border-blue-800/40 rounded-lg px-3 py-2 text-sm resize-none" />
              </div>
              <div className="bg-amber-900/10 border border-amber-800/30 rounded-lg p-3">
                <label htmlFor="q-internal-note" className="text-sm mb-1 text-amber-200 flex items-center gap-1.5"><AlertTriangle size={13} /> Internal Note (never shown in the customer document)</label>
                <textarea id="q-internal-note" value={form.internalNote} onChange={set("internalNote")} rows={2} className="w-full bg-gray-900/60 border border-amber-800/40 rounded-lg px-3 py-2 text-sm resize-none" />
              </div>
              <div>
                <label htmlFor="q-terms" className="block text-sm mb-1 text-gray-300">Terms and Conditions</label>
                <textarea id="q-terms" value={form.termsAndConditions} onChange={set("termsAndConditions")} rows={3} aria-invalid={!!errors.termsAndConditions} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm resize-none ${errors.termsAndConditions ? "border-red-600" : "border-gray-700"}`} />
                {errors.termsAndConditions && <p className="text-xs text-red-400 mt-1">{errors.termsAndConditions}</p>}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label htmlFor="q-assumptions" className="block text-sm mb-1 text-gray-300">Assumptions (optional)</label><textarea id="q-assumptions" value={form.assumptions} onChange={set("assumptions")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" /></div>
                <div><label htmlFor="q-exclusions" className="block text-sm mb-1 text-gray-300">Exclusions (optional)</label><textarea id="q-exclusions" value={form.exclusions} onChange={set("exclusions")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" /></div>
              </div>
              {isNewVersion && (
                <div>
                  <label htmlFor="q-change-summary" className="block text-sm mb-1 text-gray-300">Change Summary (required for a new version)</label>
                  <textarea id="q-change-summary" value={form.changeSummary} onChange={set("changeSummary")} rows={2} aria-invalid={!!errors.changeSummary} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm resize-none ${errors.changeSummary ? "border-red-600" : "border-gray-700"}`} />
                  {errors.changeSummary && <p className="text-xs text-red-400 mt-1">{errors.changeSummary}</p>}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Document Design</h2>
              <div className="flex gap-2">
                {DOCUMENT_LAYOUTS.map((l) => (
                  <button key={l} type="button" onClick={() => setForm((f) => ({ ...f, documentLayout: l }))} className={`px-3 py-1.5 rounded-full text-sm border ${form.documentLayout === l ? "bg-blue-700 border-blue-600" : "border-gray-700 text-gray-400 hover:text-white"}`}>{l}</button>
                ))}
              </div>
              <QuoteDocumentPreview
                quote={form} company={companies.find((c) => c._id === form.companyId)} contact={allContacts.find((c) => c._id === form.primaryContactId)}
                ownerName={CRM_TEAM.find((u) => u.id === form.ownerId)?.name} layout={form.documentLayout}
              />
            </div>
          )}

          {step === 4 && (
            <ReviewStep form={form} totals={totals} warnings={warnings} companies={companies} allContacts={allContacts} selectedDeal={selectedDeal} />
          )}
        </div>
      </div>

      <div className="flex justify-between items-center px-4 sm:px-8 py-4 border-t border-gray-800 bg-gray-950">
        <button type="button" onClick={requestClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
        <div className="flex gap-2 flex-wrap">
          {step > 0 && <button type="button" onClick={() => setStep((s) => s - 1)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Back</button>}
          {step < STEPS.length - 1 && <button type="button" onClick={() => setStep((s) => s + 1)} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Next</button>}
          {step === STEPS.length - 1 && (
            <>
              <button type="button" disabled={saving} onClick={() => save(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm disabled:opacity-50">Save Frontend Draft</button>
              <button type="button" disabled={saving} onClick={() => save(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium"><Check size={15} /> Submit for Frontend Review</button>
            </>
          )}
        </div>
      </div>

      {confirmClose && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold">Discard unsaved changes?</h3>
            <p className="text-sm text-gray-400">You have unsaved changes to this Quote. Closing now will discard them.</p>
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

function LineItemCard({ line, idx, total, currency, errors, overridingKey, setOverridingKey, onUpdate, onRemove, onDuplicate, onMove, onOverride, onRevert }) {
  const lineTotal = computeLineTotal(line);
  const isOverriding = overridingKey === line._key;
  const [overridePrice, setOverridePrice] = useState(line.unitPrice);
  const [overrideReason, setOverrideReason] = useState("");
  const errKey = Object.keys(errors).find((k) => k.startsWith(`line_${idx}_`));

  return (
    <div className={`border rounded-xl p-3 space-y-2 ${line.included === false ? "border-dashed border-gray-700 opacity-70" : "border-gray-800"}`}>
      <div className="flex justify-between items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-40">
          {line.catalogItemId ? (
            <p className="font-medium text-sm">{line.name} <span className="text-xs text-gray-500">(catalog item)</span></p>
          ) : (
            <input value={line.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="Line name" className="w-full bg-gray-800/60 border border-gray-700 rounded px-2 py-1 text-sm font-medium" />
          )}
          <input value={line.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="Description" className="w-full bg-transparent border-none text-xs text-gray-400 px-0 mt-1 focus:outline-none focus:ring-0" />
        </div>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1 text-xs text-gray-400 mr-2"><input type="checkbox" checked={line.included !== false} onChange={(e) => onUpdate({ included: e.target.checked })} /> Included</label>
          <button type="button" onClick={() => onMove(-1)} disabled={idx === 0} aria-label="Move up" className="p-1 text-gray-400 hover:text-white disabled:opacity-30"><ArrowUp size={14} /></button>
          <button type="button" onClick={() => onMove(1)} disabled={idx === total - 1} aria-label="Move down" className="p-1 text-gray-400 hover:text-white disabled:opacity-30"><ArrowDown size={14} /></button>
          <button type="button" onClick={onDuplicate} aria-label="Duplicate line" className="p-1 text-gray-400 hover:text-white"><Copy size={14} /></button>
          <button type="button" onClick={onRemove} aria-label="Remove line" className="p-1 text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <div><label className="block text-gray-500 mb-0.5">Qty</label><input type="number" min="0" value={line.quantity} onChange={(e) => onUpdate({ quantity: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded px-2 py-1" /></div>
        <div><label className="block text-gray-500 mb-0.5">Unit</label><input value={line.unit} onChange={(e) => onUpdate({ unit: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded px-2 py-1" /></div>
        <div><label className="block text-gray-500 mb-0.5">Billing Model</label>
          <select value={line.billingModel} onChange={(e) => onUpdate({ billingModel: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded px-2 py-1">
            {["One Time", "Recurring", "Usage Based", "Custom Quote"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div><label className="block text-gray-500 mb-0.5">Interval</label>
          <select value={line.billingInterval || ""} onChange={(e) => onUpdate({ billingInterval: e.target.value || null })} className="w-full bg-gray-800/60 border border-gray-700 rounded px-2 py-1">
            <option value="">—</option>{BILLING_INTERVALS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div><label className="block text-gray-500 mb-0.5">Tax Category</label>
          <select value={line.taxCategory} onChange={(e) => onUpdate({ taxCategory: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded px-2 py-1">
            {TAX_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs items-end">
        <div><p className="text-gray-500">List Price</p><p className="text-gray-300">{line.listPrice != null ? formatMoney(line.listPrice, currency) : "—"}</p></div>
        <div><p className="text-gray-500">Price Book Price</p><p className="text-gray-300">{line.priceBookPrice != null ? formatMoney(line.priceBookPrice, currency) : "—"}</p></div>
        <div>
          <p className="text-gray-500">Unit Price {line.isOverridden && <span className="text-amber-400">(overridden)</span>}</p>
          <div className="flex items-center gap-1">
            <p className="font-medium">{formatMoney(line.unitPrice, currency)}</p>
            {!isOverriding && <button type="button" onClick={() => { setOverridingKey(line._key); setOverridePrice(line.unitPrice); setOverrideReason(line.overrideReason || ""); }} className="text-blue-400 hover:underline">Override</button>}
            {line.isOverridden && <button type="button" onClick={onRevert} className="text-gray-400 hover:underline">Revert</button>}
          </div>
        </div>
        <div>
          <p className="text-gray-500">Discount</p>
          <div className="flex gap-1">
            <select value={line.discountType || ""} onChange={(e) => onUpdate({ discountType: e.target.value || null })} className="bg-gray-800/60 border border-gray-700 rounded px-1 py-1 text-xs">
              <option value="">None</option>{DISCOUNT_TYPES.map((t) => <option key={t} value={t}>{t === "Percentage" ? "%" : "$"}</option>)}
            </select>
            <input type="number" min="0" value={line.discountValue ?? ""} onChange={(e) => onUpdate({ discountValue: e.target.value })} disabled={!line.discountType} className="w-14 bg-gray-800/60 border border-gray-700 rounded px-1 py-1 text-xs disabled:opacity-50" />
          </div>
        </div>
      </div>

      {isOverriding && (
        <div className="bg-gray-800/40 rounded-lg p-2 flex flex-wrap gap-2 items-end text-xs">
          <div><label className="block text-gray-400 mb-0.5">New unit price</label><input type="number" value={overridePrice} onChange={(e) => setOverridePrice(e.target.value)} className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1" /></div>
          <div className="flex-1 min-w-32"><label className="block text-gray-400 mb-0.5">Reason (required)</label><input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1" /></div>
          <button type="button" disabled={!overrideReason.trim()} onClick={() => onOverride(overridePrice, overrideReason)} className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-50">Apply Override</button>
          <button type="button" onClick={() => setOverridingKey(null)} className="px-3 py-1.5 rounded-lg border border-gray-700">Cancel</button>
          <p className="w-full text-amber-300">Overriding a Price Book value may require approval before this Quote can be submitted.</p>
        </div>
      )}

      <div className="flex justify-between items-center pt-1 border-t border-gray-800 text-sm">
        <input value={line.sectionTitle || ""} onChange={(e) => onUpdate({ sectionTitle: e.target.value || null })} placeholder="Section (optional grouping)" className="bg-transparent text-xs text-gray-500 border-none focus:outline-none focus:ring-0 w-48" />
        <span className="font-semibold">{formatMoney(lineTotal, currency)}</span>
      </div>
      {errKey && <p className="text-xs text-red-400">{errors[errKey]}</p>}
    </div>
  );
}

function ReviewStep({ form, totals, warnings, companies, allContacts, selectedDeal }) {
  const company = companies.find((c) => c._id === form.companyId);
  const contact = allContacts.find((c) => c._id === form.primaryContactId);
  const overridden = form.lineItems.filter((l) => l.isOverridden);
  const { errors: missing } = validateQuotePayload(
    { ...form, lineItems: form.lineItems },
    { forSubmit: false },
  );
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Review</h2>
      {Object.keys(missing).length > 0 && (
        <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3 text-xs text-red-200">
          <p className="font-medium mb-1">Missing or invalid fields:</p>
          <ul className="list-disc list-inside">{Object.values(missing).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div className="bg-gray-800/30 rounded-lg p-3 space-y-1">
          <p><span className="text-gray-500">Customer:</span> {company?.name || "—"}</p>
          <p><span className="text-gray-500">Contact:</span> {contact?.name || "—"}</p>
          <p><span className="text-gray-500">Deal:</span> {selectedDeal?.name || "None"}</p>
          <p><span className="text-gray-500">Valid until:</span> {form.validUntilDate || "—"}</p>
        </div>
        <div className="bg-gray-800/30 rounded-lg p-3 space-y-1">
          <p><span className="text-gray-500">Subtotal:</span> {formatMoney(totals.subtotal, form.currency)}</p>
          <p><span className="text-gray-500">Discount:</span> {formatMoney(totals.overallDiscountAmount, form.currency)}</p>
          <p><span className="text-gray-500">Tax:</span> {formatMoney(totals.tax, form.currency)}</p>
          <p className="font-semibold"><span className="text-gray-500 font-normal">Grand Total:</span> {formatMoney(totals.grandTotal, form.currency)}</p>
        </div>
      </div>
      {overridden.length > 0 && (
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200">
          <p className="font-medium mb-1">Price overrides:</p>
          <ul className="list-disc list-inside">{overridden.map((l) => <li key={l._key}>{l.name}: {formatMoney(l.unitPrice, form.currency)} — {l.overrideReason}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3 text-xs text-red-200">
          <p className="font-medium mb-1 flex items-center gap-1.5"><AlertTriangle size={13} /> Approval warnings (frontend preview only):</p>
          <ul className="list-disc list-inside">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </div>
      )}
      <p className="text-xs text-gray-500">Internal notes are excluded from the customer document preview below.</p>
      <QuoteDocumentPreview quote={form} company={company} contact={contact} ownerName={undefined} layout={form.documentLayout} />
      <p className="text-xs text-gray-500">Saving here adds this Quote to this session's shared frontend state only — no production Quote is created, sent, or persisted to a backend.</p>
    </div>
  );
}
