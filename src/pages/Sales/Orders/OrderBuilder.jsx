import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { X, Plus, Trash2, Copy, ArrowUp, ArrowDown, AlertTriangle, Check, Search } from "lucide-react";
import {
  createOrder, updateOrder,
  PAYMENT_TERMS_OPTIONS, BILLING_SCHEDULES, ORDER_TYPES,
} from "../../../redux/sales/ordersSlice";
import {
  makeOrderLine, computeLineTotal, computeOrderTotals, validateOrderPayload,
  buildOrderFromQuotePreview, buildOrderDuplicatePreview, deriveOrderType,
  DISCOUNT_TYPES,
} from "../../../Helpers/mockOrderData";
import { resolveLinePricing } from "../../../Helpers/mockQuoteData";
import { catalogItems, findCatalogItem, TAX_CATEGORIES, BILLING_INTERVALS } from "../../../Helpers/mockCatalogData";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchPriceBooks } from "../../../redux/sales/priceBooksSlice";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney } from "./orderUtils";
import OrderDocumentPreview from "./OrderDocumentPreview";

const STEPS = ["Customer", "Products and Services", "Fulfillment", "Billing Preview", "Review"];
const randKey = () => Math.random().toString(36).slice(2);
const emptyAddress = () => ({ line1: "", city: "", state: "", postalCode: "", country: "" });

function emptyForm(prefillQuoteData) {
  const base = {
    companyId: "", contactId: "", dealId: "", customerReference: "", ownerId: "", assignedTeam: "Sales",
    orderDate: new Date().toISOString().slice(0, 10), currency: "USD",
    lineItems: [], orderType: "Product Order",
    requestedDate: "", serviceAddress: emptyAddress(), deliveryInstructions: "", serviceStartInstructions: "",
    paymentTerms: "Net 30", billingSchedule: "One-time billing", billingContactId: "", billingSameAsService: true, billingAddress: emptyAddress(),
    customerNote: "", internalNote: "", sourceQuoteId: null, sourceQuoteVersion: null,
  };
  if (!prefillQuoteData) return base;
  return {
    ...base,
    companyId: prefillQuoteData.companyId || "", contactId: prefillQuoteData.contactId || "", dealId: prefillQuoteData.dealId || "",
    ownerId: prefillQuoteData.ownerId || "", assignedTeam: prefillQuoteData.assignedTeam || "Sales", currency: prefillQuoteData.currency || "USD",
    paymentTerms: prefillQuoteData.paymentTerms || "Net 30", billingSchedule: prefillQuoteData.billingSchedule || "One-time billing",
    billingContactId: prefillQuoteData.contactId || "", customerNote: prefillQuoteData.customerNote || "",
    sourceQuoteId: prefillQuoteData.sourceQuoteId, sourceQuoteVersion: prefillQuoteData.sourceQuoteVersion,
    lineItems: (prefillQuoteData.lineItems || []).map((l) => ({ ...makeOrderLine(l), _key: randKey() })),
    orderType: deriveOrderType((prefillQuoteData.lineItems || []).map((l) => makeOrderLine(l))),
  };
}
function formFromOrder(o) {
  return {
    companyId: o.companyId || "", contactId: o.contactId || "", dealId: o.dealId || "", customerReference: o.customerReference || "",
    ownerId: o.ownerId || "", assignedTeam: o.assignedTeam || "Sales", orderDate: o.orderDate ? o.orderDate.slice(0, 10) : "", currency: o.currency || "USD",
    lineItems: (o.lineItems || []).map((l) => ({ ...l, _key: l._id || randKey() })),
    orderType: o.orderType || "Product Order",
    requestedDate: o.requestedDate ? o.requestedDate.slice(0, 10) : "", serviceAddress: o.serviceAddress || emptyAddress(),
    deliveryInstructions: o.deliveryInstructions || "", serviceStartInstructions: o.serviceStartInstructions || "",
    paymentTerms: o.paymentTerms || "Net 30", billingSchedule: o.billingSchedule || "One-time billing",
    billingContactId: o.billingContactId || "", billingSameAsService: !o.billingAddress, billingAddress: o.billingAddress || emptyAddress(),
    customerNote: o.customerNote || "", internalNote: o.internalNote || "", sourceQuoteId: o.sourceQuoteId || null, sourceQuoteVersion: o.sourceQuoteVersion ?? null,
  };
}

export default function OrderBuilder({ mode, order, sourceQuoteId, onClose, onSaved }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const isEdit = mode === "edit";
  const isDuplicate = mode === "duplicate";
  const isFromQuote = mode === "fromQuote";

  const initialSource = useMemo(() => {
    if (isEdit) return order;
    if (isDuplicate) return buildOrderDuplicatePreview(order._id);
    if (isFromQuote) return buildOrderFromQuotePreview(sourceQuoteId);
    return null;
  }, [isEdit, isDuplicate, isFromQuote, order, sourceQuoteId]);

  const [form, setForm] = useState(() => {
    if (isEdit || isDuplicate) return formFromOrder(initialSource);
    if (isFromQuote) return emptyForm(initialSource);
    return emptyForm(null);
  });
  const initialFormRef = useRef(form);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

  useEffect(() => {
    dispatch(fetchCompanies()); dispatch(fetchContacts()); dispatch(fetchDeals()); dispatch(fetchPriceBooks());
  }, [dispatch]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const requestClose = () => (isDirty ? setConfirmClose(true) : onClose());
  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const setAddr = (which) => (field) => (e) => setForm((f) => ({ ...f, [which]: { ...f[which], [field]: e.target.value } }));

  const companyContacts = useMemo(() => allContacts.filter((c) => c.companyId === form.companyId), [allContacts, form.companyId]);
  const companyDeals = useMemo(() => deals.filter((d) => d.companyId === form.companyId), [deals, form.companyId]);

  // --- Line item management ---
  const addedIds = new Set(form.lineItems.filter((l) => l.catalogItemId).map((l) => l.catalogItemId));
  const searchResults = useMemo(() => {
    if (!itemSearch.trim()) return [];
    const q = itemSearch.trim().toLowerCase();
    return catalogItems.filter((c) => c.status === "Active" && !c.archived && !addedIds.has(c._id) && c.name.toLowerCase().includes(q)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSearch, form.lineItems]);

  const recomputeOrderType = (lines) => setForm((f) => ({ ...f, orderType: deriveOrderType(lines) }));

  const addCatalogLine = (catalogItemId) => {
    const c = findCatalogItem(catalogItemId);
    if (!c) return;
    const priced = resolveLinePricing({ catalogItemId, priceBookId: null, quantity: 1 });
    const line = makeOrderLine({ catalogItemId, quantity: 1, listPriceSnapshot: priced.listPrice, unitPrice: priced.resolvedPrice, order: form.lineItems.length });
    const next = [...form.lineItems, { ...line, _key: randKey() }];
    setForm((f) => ({ ...f, lineItems: next }));
    recomputeOrderType(next);
    setItemSearch("");
  };
  const addCustomLine = () => {
    const line = makeOrderLine({ name: "New custom line", description: "", unitPrice: 0, quantity: 1, order: form.lineItems.length });
    const next = [...form.lineItems, { ...line, _key: randKey() }];
    setForm((f) => ({ ...f, lineItems: next }));
    recomputeOrderType(next);
  };
  const duplicateLine = (key) => {
    const line = form.lineItems.find((l) => l._key === key);
    if (!line) return;
    setForm((f) => ({ ...f, lineItems: [...f.lineItems, { ...line, _key: randKey(), _id: undefined }] }));
  };
  const removeLine = (key) => {
    const next = form.lineItems.filter((l) => l._key !== key);
    setForm((f) => ({ ...f, lineItems: next }));
    recomputeOrderType(next);
  };
  const updateLine = (key, changes) => {
    const next = form.lineItems.map((l) => (l._key === key ? { ...l, ...changes } : l));
    setForm((f) => ({ ...f, lineItems: next }));
    if (changes.lineKind) recomputeOrderType(next);
  };
  const moveLine = (key, dir) => {
    const idx = form.lineItems.findIndex((l) => l._key === key);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= form.lineItems.length) return;
    const next = [...form.lineItems];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setForm((f) => ({ ...f, lineItems: next.map((l, i) => ({ ...l, order: i })) }));
  };

  const totals = useMemo(() => computeOrderTotals(form), [form]);

  const buildPayload = () => ({
    companyId: form.companyId || null, contactId: form.contactId || null, dealId: form.dealId || null,
    customerReference: form.customerReference, ownerId: form.ownerId || null, assignedTeam: form.assignedTeam,
    orderDate: form.orderDate ? new Date(form.orderDate).toISOString() : null, currency: form.currency,
    orderType: form.orderType,
    requestedDate: form.requestedDate ? new Date(form.requestedDate).toISOString() : null,
    serviceAddress: form.orderType === "Service Order" ? null : form.serviceAddress,
    deliveryInstructions: form.deliveryInstructions, serviceStartInstructions: form.serviceStartInstructions,
    paymentTerms: form.paymentTerms, billingSchedule: form.billingSchedule,
    billingContactId: form.billingContactId || form.contactId || null,
    billingAddress: form.billingSameAsService ? null : form.billingAddress,
    customerNote: form.customerNote, internalNote: form.internalNote,
    sourceQuoteId: form.sourceQuoteId, sourceQuoteVersion: form.sourceQuoteVersion,
    lineItems: form.lineItems.map((l) => ({
      catalogItemId: l.catalogItemId || null, isCustomLine: !l.catalogItemId, lineKind: l.lineKind, name: l.name, description: l.description || "",
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
    if (keys.includes("serviceAddress")) return setStep(2);
    if (keys.some((k) => ["billingContactId", "paymentTerms"].includes(k))) return setStep(3);
  };

  const save = async (forSubmit) => {
    setSaving(true);
    setErrors({});
    const payload = buildPayload();
    const { errors: valErrors } = validateOrderPayload(payload);
    if (Object.keys(valErrors).length > 0) {
      setErrors(valErrors);
      jumpToFirstErrorStep(valErrors);
      setSaving(false);
      return;
    }

    let result;
    if (isEdit) result = await dispatch(updateOrder({ id: order._id, changes: payload }));
    else result = await dispatch(createOrder(payload));
    setSaving(false);

    const fulfilled = isEdit ? updateOrder.fulfilled.match(result) : createOrder.fulfilled.match(result);
    if (!fulfilled) {
      const errs = result.payload?.errors || {};
      setErrors(errs);
      jumpToFirstErrorStep(errs);
      return;
    }
    const savedOrder = result.payload;
    initialFormRef.current = form;
    onSaved?.(savedOrder);
    navigate(`/sales/orders/${savedOrder._id}`);
    onClose();
    void forSubmit; // reserved: "Submit for Frontend Review" saves as Draft; the review submission itself happens from the detail page's own action.
  };

  const title = isEdit ? `Edit Draft — ${order.orderNumber}` : isDuplicate ? `Duplicate — ${order.orderNumber}` : isFromQuote ? "Create Order from Quote" : "Create Manual Order";

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col text-white" role="dialog" aria-modal="true" aria-label={title} ref={containerRef}>
      <div className="flex justify-between items-center px-4 sm:px-8 py-4 border-b border-gray-800 bg-gray-950">
        <h1 className="text-lg font-bold">{title}</h1>
        <button onClick={requestClose} aria-label="Close"><X size={22} /></button>
      </div>

      <nav aria-label="Order builder steps" className="flex flex-col sm:flex-row gap-1 px-4 sm:px-8 py-2 border-b border-gray-800 bg-gray-950 overflow-x-auto">
        {STEPS.map((label, idx) => (
          <button key={label} type="button" onClick={() => setStep(idx)} aria-current={step === idx ? "step" : undefined}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm sm:rounded-lg ${step === idx ? "bg-blue-700 text-white" : "text-gray-400 hover:text-white hover:bg-gray-900"}`}>
            <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[11px] shrink-0">{idx + 1}</span>{label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {form.sourceQuoteId && (
            <div className="bg-blue-900/15 border border-blue-800/30 rounded-xl p-3 text-xs text-blue-200">
              This Order was pre-filled from a Quote snapshot. Future changes to that Quote will not update this Order.
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Customer</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="o-company" className="block text-sm mb-1 text-gray-300">Company</label>
                  <select id="o-company" value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, contactId: "" }))}
                    aria-invalid={!!errors.companyId} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.companyId ? "border-red-600" : "border-gray-700"}`}>
                    <option value="">Select a company...</option>
                    {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                  {errors.companyId && <p className="text-xs text-red-400 mt-1">{errors.companyId}</p>}
                </div>
                <div>
                  <label htmlFor="o-contact" className="block text-sm mb-1 text-gray-300">Primary Contact</label>
                  <select id="o-contact" value={form.contactId} onChange={set("contactId")} disabled={!form.companyId} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                    <option value="">{form.companyId ? "Select a contact..." : "Select a company first"}</option>
                    {companyContacts.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                  {errors.contactId && <p className="text-xs text-amber-400 mt-1">{errors.contactId}</p>}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="o-deal" className="block text-sm mb-1 text-gray-300">Related Deal</label>
                  <select id="o-deal" value={form.dealId} onChange={set("dealId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    <option value="">No related Deal</option>
                    {(form.companyId ? companyDeals : deals).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="o-ref" className="block text-sm mb-1 text-gray-300">Customer Reference (PO #, etc.)</label>
                  <input id="o-ref" value={form.customerReference} onChange={set("customerReference")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid sm:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="o-owner" className="block text-sm mb-1 text-gray-300">Owner</label>
                  <select id="o-owner" value={form.ownerId} onChange={set("ownerId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    <option value="">Unassigned</option>{crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="o-team" className="block text-sm mb-1 text-gray-300">Team</label>
                  <select id="o-team" value={form.assignedTeam} onChange={set("assignedTeam")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    {["Sales", "Support", "Marketing"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="o-date" className="block text-sm mb-1 text-gray-300">Order Date</label>
                  <input id="o-date" type="date" value={form.orderDate} onChange={set("orderDate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="o-currency" className="block text-sm mb-1 text-gray-300">Currency</label>
                  <select id="o-currency" value={form.currency} onChange={set("currency")} aria-invalid={!!errors.currency} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.currency ? "border-red-600" : "border-gray-700"}`}>
                    {["USD", "EUR", "GBP", "INR", "IDR"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Products and Services</h2>
              <p className="text-xs text-gray-500">Order type: <span className="text-gray-300 font-medium">{form.orderType}</span> (derived from the line items below)</p>
              <div className="flex gap-2 flex-wrap items-end">
                <div className="flex-1 min-w-52 relative">
                  <label htmlFor="o-item-search" className="block text-sm mb-1 text-gray-300">Add a Product or Service</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input id="o-item-search" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search the catalog..." className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm" />
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
                <button type="button" onClick={addCustomLine} className="px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm whitespace-nowrap">+ Custom Line</button>
              </div>
              {errors.lineItems && <p className="text-xs text-red-400">{errors.lineItems}</p>}

              <div className="space-y-3">
                {form.lineItems.length === 0 ? (
                  <p className="text-sm text-gray-500">No line items yet — search the catalog above or add a custom line.</p>
                ) : form.lineItems.map((line, idx) => (
                  <OrderLineCard key={line._key} line={line} idx={idx} total={form.lineItems.length} currency={form.currency} errors={errors}
                    onUpdate={(changes) => updateLine(line._key, changes)} onRemove={() => removeLine(line._key)} onDuplicate={() => duplicateLine(line._key)} onMove={(dir) => moveLine(line._key, dir)} />
                ))}
              </div>

              <div className="bg-gray-800/40 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>{formatMoney(totals.subtotal, form.currency)}</span></div>
                <div className="flex justify-between text-gray-400"><span>Tax (estimate)</span><span>{formatMoney(totals.tax, form.currency)}</span></div>
                <div className="flex justify-between font-semibold pt-1 border-t border-gray-700"><span>Grand Total</span><span>{formatMoney(totals.grandTotal, form.currency)}</span></div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Fulfillment</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="o-order-type" className="block text-sm mb-1 text-gray-300">Order Type</label>
                  <select id="o-order-type" value={form.orderType} onChange={set("orderType")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    {ORDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="o-requested" className="block text-sm mb-1 text-gray-300">Requested Start/Delivery Date</label>
                  <input id="o-requested" type="date" value={form.requestedDate} onChange={set("requestedDate")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {form.orderType !== "Service Order" && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-300">Delivery Address</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <input value={form.serviceAddress.line1} onChange={setAddr("serviceAddress")("line1")} placeholder="Street address" aria-invalid={!!errors.serviceAddress} className={`bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.serviceAddress ? "border-red-600" : "border-gray-700"}`} />
                    <input value={form.serviceAddress.city} onChange={setAddr("serviceAddress")("city")} placeholder="City" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                    <input value={form.serviceAddress.state} onChange={setAddr("serviceAddress")("state")} placeholder="State/Province" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                    <input value={form.serviceAddress.postalCode} onChange={setAddr("serviceAddress")("postalCode")} placeholder="Postal code" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                    <input value={form.serviceAddress.country} onChange={setAddr("serviceAddress")("country")} placeholder="Country" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm sm:col-span-2" />
                  </div>
                  {errors.serviceAddress && <p className="text-xs text-red-400">{errors.serviceAddress}</p>}
                  <textarea value={form.deliveryInstructions} onChange={set("deliveryInstructions")} rows={2} placeholder="Delivery instructions" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
                </div>
              )}
              {(form.orderType === "Service Order" || form.orderType === "Mixed Order") && (
                <div>
                  <label htmlFor="o-service-instructions" className="block text-sm mb-1 text-gray-300">Service-Start Instructions</label>
                  <textarea id="o-service-instructions" value={form.serviceStartInstructions} onChange={set("serviceStartInstructions")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Billing Preview</h2>
              <p className="text-xs text-gray-500">No invoice is created here. Invoices are made in Finance.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="o-payment-terms" className="block text-sm mb-1 text-gray-300">Payment Terms</label>
                  <select id="o-payment-terms" value={form.paymentTerms} onChange={set("paymentTerms")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    {PAYMENT_TERMS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="o-billing-schedule" className="block text-sm mb-1 text-gray-300">Billing Schedule</label>
                  <select id="o-billing-schedule" value={form.billingSchedule} onChange={set("billingSchedule")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                    {BILLING_SCHEDULES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="o-billing-contact" className="block text-sm mb-1 text-gray-300">Billing Contact</label>
                <select id="o-billing-contact" value={form.billingContactId} onChange={set("billingContactId")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">Same as primary contact</option>
                  {companyContacts.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={form.billingSameAsService} onChange={(e) => setForm((f) => ({ ...f, billingSameAsService: e.target.checked }))} /> Billing address same as delivery address
              </label>
              {!form.billingSameAsService && (
                <div className="grid sm:grid-cols-2 gap-2">
                  <input value={form.billingAddress.line1} onChange={setAddr("billingAddress")("line1")} placeholder="Street address" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                  <input value={form.billingAddress.city} onChange={setAddr("billingAddress")("city")} placeholder="City" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                  <input value={form.billingAddress.postalCode} onChange={setAddr("billingAddress")("postalCode")} placeholder="Postal code" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                  <input value={form.billingAddress.country} onChange={setAddr("billingAddress")("country")} placeholder="Country" className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
              <div className="bg-gray-800/40 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between text-gray-400"><span>One-Time Amount</span><span>{formatMoney(totals.oneTimeTotal, form.currency)}</span></div>
                <div className="flex justify-between text-gray-400"><span>Recurring Amount</span><span>{formatMoney(totals.recurringTotal, form.currency)}</span></div>
                <div className="flex justify-between text-gray-400"><span>Tax</span><span>{formatMoney(totals.tax, form.currency)}</span></div>
                <div className="flex justify-between font-semibold pt-1 border-t border-gray-700"><span>Grand Total</span><span>{formatMoney(totals.grandTotal, form.currency)}</span></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="bg-blue-900/10 border border-blue-800/30 rounded-lg p-3">
                  <label htmlFor="o-customer-note" className="block text-sm mb-1 text-blue-200">Customer Note</label>
                  <textarea id="o-customer-note" value={form.customerNote} onChange={set("customerNote")} rows={2} className="w-full bg-gray-900/60 border border-blue-800/40 rounded-lg px-3 py-2 text-sm resize-none" />
                </div>
                <div className="bg-amber-900/10 border border-amber-800/30 rounded-lg p-3">
                  <label htmlFor="o-internal-note" className="text-sm mb-1 text-amber-200 flex items-center gap-1.5"><AlertTriangle size={13} /> Internal Note</label>
                  <textarea id="o-internal-note" value={form.internalNote} onChange={set("internalNote")} rows={2} className="w-full bg-gray-900/60 border border-amber-800/40 rounded-lg px-3 py-2 text-sm resize-none" />
                </div>
              </div>
            </div>
          )}

          {step === 4 && <ReviewStep form={form} totals={totals} companies={companies} allContacts={allContacts} />}
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
            <p className="text-sm text-gray-400">You have unsaved changes to this Order. Closing now will discard them.</p>
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

function OrderLineCard({ line, idx, total, currency, errors, onUpdate, onRemove, onDuplicate, onMove }) {
  const lineTotal = computeLineTotal(line);
  const errKey = Object.keys(errors).find((k) => k.startsWith(`line_${idx}_`));
  return (
    <div className="border border-gray-800 rounded-xl p-3 space-y-2">
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
          <label className="flex items-center gap-1 text-xs text-gray-400 mr-2">
            Kind
            <select value={line.lineKind} onChange={(e) => onUpdate({ lineKind: e.target.value })} className="bg-gray-800/60 border border-gray-700 rounded px-1 py-0.5 text-xs">
              <option value="Product">Product</option><option value="Service">Service</option>
            </select>
          </label>
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
        <div><p className="text-gray-500">Price Snapshot</p><input type="number" min="0" value={line.unitPrice} onChange={(e) => onUpdate({ unitPrice: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded px-2 py-1" /></div>
        <div>
          <p className="text-gray-500">Discount Snapshot</p>
          <div className="flex gap-1">
            <select value={line.discountType || ""} onChange={(e) => onUpdate({ discountType: e.target.value || null })} className="bg-gray-800/60 border border-gray-700 rounded px-1 py-1 text-xs">
              <option value="">None</option>{DISCOUNT_TYPES.map((t) => <option key={t} value={t}>{t === "Percentage" ? "%" : "$"}</option>)}
            </select>
            <input type="number" min="0" value={line.discountValue ?? ""} onChange={(e) => onUpdate({ discountValue: e.target.value })} disabled={!line.discountType} className="w-14 bg-gray-800/60 border border-gray-700 rounded px-1 py-1 text-xs disabled:opacity-50" />
          </div>
        </div>
        <div><p className="text-gray-500">Tax</p><p className="text-gray-300 pt-1">{line.taxCategory}</p></div>
        <div><p className="text-gray-500">Line Total</p><p className="font-semibold pt-1">{formatMoney(lineTotal, currency)}</p></div>
      </div>
      {errKey && <p className="text-xs text-red-400">{errors[errKey]}</p>}
    </div>
  );
}

function ReviewStep({ form, totals, companies, allContacts }) {
  const company = companies.find((c) => c._id === form.companyId);
  const contact = allContacts.find((c) => c._id === form.contactId);
  const { errors: missing, warnings } = validateOrderPayload({
    companyId: form.companyId, contactId: form.contactId, currency: form.currency, orderType: form.orderType,
    paymentTerms: form.paymentTerms, requestedDate: form.requestedDate, billingContactId: form.billingContactId || form.contactId,
    serviceAddress: form.serviceAddress, lineItems: form.lineItems, sourceQuoteId: form.sourceQuoteId,
  });
  const previewOrder = { ...form, lineItems: form.lineItems };
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Review</h2>
      {Object.keys(missing).length > 0 && (
        <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3 text-xs text-red-200">
          <p className="font-medium mb-1">Missing or invalid fields:</p>
          <ul className="list-disc list-inside">{Object.values(missing).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {Object.keys(warnings).length > 0 && (
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200">
          <p className="font-medium mb-1 flex items-center gap-1.5"><AlertTriangle size={13} /> Warnings:</p>
          <ul className="list-disc list-inside">{Object.values(warnings).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div className="bg-gray-800/30 rounded-lg p-3 space-y-1">
          <p><span className="text-gray-500">Customer:</span> {company?.name || "—"}</p>
          <p><span className="text-gray-500">Contact:</span> {contact?.name || "—"}</p>
          <p><span className="text-gray-500">Order Type:</span> {form.orderType}</p>
          <p><span className="text-gray-500">Source Quote:</span> {form.sourceQuoteId ? "Linked (snapshot copied)" : "None — manual Order"}</p>
        </div>
        <div className="bg-gray-800/30 rounded-lg p-3 space-y-1">
          <p><span className="text-gray-500">One-Time:</span> {formatMoney(totals.oneTimeTotal, form.currency)}</p>
          <p><span className="text-gray-500">Recurring:</span> {formatMoney(totals.recurringTotal, form.currency)}</p>
          <p><span className="text-gray-500">Tax:</span> {formatMoney(totals.tax, form.currency)}</p>
          <p className="font-semibold"><span className="text-gray-500 font-normal">Grand Total:</span> {formatMoney(totals.grandTotal, form.currency)}</p>
        </div>
      </div>
      <p className="text-xs text-gray-500">Internal notes are excluded from the customer-facing document preview below.</p>
      <OrderDocumentPreview order={previewOrder} company={company} contact={contact} sourceQuote={null} />
      <p className="text-xs text-gray-500">Saving creates the order. No invoice or contract is created automatically.</p>
    </div>
  );
}
