import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Pencil, Copy, Archive, RotateCcw, MoreHorizontal, ArrowLeft, Printer, Download,
  Package, AlertTriangle, Shield, PlusCircle,
} from "lucide-react";
import {
  fetchOrder, updateOrder, archiveOrder, restoreOrder, submitForReview, confirmOrder, startProcessing,
  putOnHold, resumeOrder, cancelOrder, markFulfilled, markCompleted, requestInvoicePreview, updateLineFulfillment,
  RELATED_RECORD_PREVIEWS,
} from "../../../redux/sales/ordersSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchQuotes } from "../../../redux/sales/quotesSlice";
import {
  getEffectiveStatus, isOverdueRequestedDate, isAwaitingBillingHandoff, computeOrderTotals, computeLineTotal,
  computeLineProgress, computeOrderProgress, ORDER_PROGRESS_EXPLANATION,
} from "../../../Helpers/mockOrderData";
import { contractsForOrder, getEffectiveStatus as getContractEffectiveStatus } from "../../../Helpers/mockContractData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatDate, formatDateTime, ORDER_STATUS_COLORS, ORDER_PROGRESSION, LOCKED_FOR_EDIT_STATUSES } from "./orderUtils";
import OrderBuilder from "./OrderBuilder";
import OrderDocumentPreview from "./OrderDocumentPreview";

const TABS = ["overview", "items", "fulfillment", "billing", "related", "activity", "document", "files", "audit"];
// Files and the audit log aren't kept by the server yet, so those tabs are hidden there.
const VISIBLE_TABS = BACKEND_CRM_SALES_MODE_ENABLED ? TABS.filter((t) => !["files", "audit"].includes(t)) : TABS;
const TAB_LABELS = {
  overview: "Overview", items: "Line Items", fulfillment: "Fulfillment", billing: "Billing",
  related: "Related Records", activity: "Activity", document: "Document", files: "Files", audit: "Audit",
};

export default function OrderDetail() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const order = useSelector((s) => s.orders.current);
  const currentNotFound = useSelector((s) => s.orders.currentNotFound);
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const allQuotes = useSelector((s) => s.quotes.items);

  const [tab, setTab] = useState(searchParams.get("tab") || "overview");
  const [builderState, setBuilderState] = useState(null);
  const [dialog, setDialog] = useState(searchParams.get("action") || null);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);

  useEffect(() => {
    dispatch(fetchOrder(id)); dispatch(fetchCompanies()); dispatch(fetchContacts()); dispatch(fetchDeals()); dispatch(fetchQuotes());
  }, [dispatch, id]);

  useEffect(() => {
    if (searchParams.get("tab") || searchParams.get("action")) {
      const next = new URLSearchParams(searchParams);
      next.delete("tab"); next.delete("action");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (currentNotFound) {
    return (
      <div className="p-6 text-white">
        <button onClick={() => navigate("/sales/orders")} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4"><ArrowLeft size={15} /> Back to Orders</button>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-400">
          <p className="mb-1">This Order couldn&apos;t be found.</p>
          <p className="text-sm text-gray-500">It may have been part of an earlier session — this in-memory data resets on a full page reload.</p>
        </div>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="p-6 text-white">
        <div className="animate-pulse space-y-4"><div className="h-4 w-40 bg-gray-800 rounded" /><div className="h-8 w-72 bg-gray-800 rounded" /><div className="h-32 bg-gray-900/40 border border-gray-800 rounded-xl" /></div>
      </div>
    );
  }

  const effStatus = getEffectiveStatus(order);
  const totals = computeOrderTotals(order);
  const progress = computeOrderProgress(order);
  const company = companies.find((c) => c._id === order.companyId);
  const contact = allContacts.find((c) => c._id === order.contactId);
  const deal = deals.find((d) => d._id === order.dealId);
  const sourceQuote = order.sourceQuoteId ? allQuotes.find((q) => q._id === order.sourceQuoteId) : null;
  const canEdit = !LOCKED_FOR_EDIT_STATUSES.includes(effStatus);

  const downloadPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text(`Order Confirmation ${order.orderNumber} — PREVIEW`, 14, 16);
    doc.setFontSize(10); doc.text(`${company?.name || "—"} · ${contact?.name || "—"}`, 14, 24);
    doc.text(`Order date ${formatDate(order.orderDate)}${order.requestedDate ? ` · Requested ${formatDate(order.requestedDate)}` : ""}`, 14, 30);
    autoTable(doc, {
      startY: 36,
      head: [["Item", "Qty", "Unit Price", "Total"]],
      body: order.lineItems.map((l) => [l.name, l.quantity, formatMoney(l.unitPrice, order.currency), formatMoney(computeLineTotal(l), order.currency)]),
    });
    const finalY = doc.lastAutoTable.finalY + 8;
    doc.text(`Grand Total: ${formatMoney(totals.grandTotal, order.currency)}`, 14, finalY);
    
    doc.save(`${order.orderNumber}-PREVIEW.pdf`);
  };

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/sales/dashboard" className="hover:text-gray-300">Sales</Link> / <Link to="/sales/orders" className="hover:text-gray-300">Orders</Link> / <span className="text-gray-300">{order.orderNumber}</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-2xl font-bold">{order.orderNumber}</h1>
            <span className={`px-2 py-1 rounded-full text-xs border ${ORDER_STATUS_COLORS[effStatus]}`}>{effStatus}</span>
            <span className="px-2 py-1 rounded-full text-xs border border-gray-700 text-gray-300">{order.orderType}</span>
            {isOverdueRequestedDate(order) && <span className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle size={13} /> Overdue requested date</span>}
          </div>
          <p className="text-sm text-gray-400">{company?.name || "No company"} · {contact?.name || "No contact"} {sourceQuote && <>· from <Link to={`/sales/quotes/${sourceQuote._id}`} className="text-blue-400 hover:underline">{sourceQuote.quoteNumber}</Link></>}</p>
          <p className="text-sm text-gray-300 mt-1">{formatMoney(totals.grandTotal, order.currency)} · {progress.toFixed(0)}% fulfilled · Requested {order.requestedDate ? formatDate(order.requestedDate) : "—"} · Owner: {order.ownerName || "Unassigned"}</p>
        </div>
        <div data-tour="order-actions" className="flex gap-2 flex-wrap">
          {canEdit && <button onClick={() => setBuilderState({ mode: "edit" })} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium"><Pencil size={15} /> Edit Draft</button>}
          <button data-tour="order-fulfil" onClick={() => setTab("fulfillment")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Package size={15} /> Update Fulfillment</button>
          <button onClick={() => setDialog("logActivity")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><PlusCircle size={15} /> Log Activity</button>
          <div className="relative">
            <button onClick={() => setRowMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={rowMenuOpen} aria-label="More actions" className="p-2 rounded-lg border border-gray-700 hover:bg-gray-800"><MoreHorizontal size={16} /></button>
            {rowMenuOpen && (
              <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-56 shadow-xl">
                <button role="menuitem" onClick={() => { setBuilderState({ mode: "duplicate" }); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><Copy size={13} /> Duplicate</button>
                {effStatus === "Draft" && <button role="menuitem" onClick={() => { setDialog("submitReview"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Submit for Review</button>}
                {effStatus === "Pending Review" && <button role="menuitem" onClick={() => { setDialog("confirm"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Confirm</button>}
                {effStatus === "Confirmed" && <button role="menuitem" onClick={() => { setDialog("startProcessing"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Start Processing</button>}
                {["Pending Review", "Confirmed", "Processing", "Partially Fulfilled"].includes(effStatus) && <button role="menuitem" onClick={() => { setDialog("hold"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Put On Hold</button>}
                {effStatus === "On Hold" && <button role="menuitem" onClick={() => { setDialog("resume"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Resume</button>}
                {["Processing", "Partially Fulfilled"].includes(effStatus) && <button role="menuitem" onClick={() => { setDialog("markFulfilled"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Mark Fulfilled</button>}
                {effStatus === "Fulfilled" && <button role="menuitem" onClick={() => { setDialog("complete"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Mark Completed</button>}
                {!["Cancelled", "Completed", "Archived"].includes(effStatus) && <button role="menuitem" onClick={() => { setDialog("cancel"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Cancel</button>}
                {order.archived ? (
                  <button role="menuitem" onClick={() => { dispatch(restoreOrder(order._id)); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><RotateCcw size={13} /> Restore</button>
                ) : (
                  <button role="menuitem" onClick={() => { setDialog("archive"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5 text-red-300"><Archive size={13} /> Archive</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <StatusRail effStatus={effStatus} onStepClick={setDialog} />

      <nav data-tour="order-tabs" className="flex gap-1 border-b border-gray-800 mb-4 mt-4 overflow-x-auto" aria-label="Order detail tabs">
        {VISIBLE_TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}
            className={`px-3 py-2 text-sm whitespace-nowrap rounded-t-lg ${tab === t ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab order={order} totals={totals} progress={progress} company={company} contact={contact} deal={deal} sourceQuote={sourceQuote} />}
      {tab === "items" && <LineItemsTab order={order} />}
      {tab === "fulfillment" && <FulfillmentTab order={order} progress={progress} dispatch={dispatch} orderId={id} />}
      {tab === "billing" && <BillingTab order={order} totals={totals} contact={contact} onRequestInvoice={() => dispatch(requestInvoicePreview(order._id))} />}
      {tab === "related" && <RelatedRecordsTab deal={deal} sourceQuote={sourceQuote} order={order} />}
      {tab === "activity" && <ActivityTab activity={order.activity || []} />}
      {tab === "document" && (
        <div className="space-y-3">
          <div className="flex gap-2 justify-end print:hidden">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm"><Printer size={14} /> Print</button>
            <button onClick={downloadPdf} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm"><Download size={14} /> Download PDF</button>
          </div>
          <style>{"@media print { body * { visibility: hidden; } #order-print-doc, #order-print-doc * { visibility: visible; } #order-print-doc { position: absolute; left: 0; top: 0; width: 100%; } }"}</style>
          <OrderDocumentPreview id="order-print-doc" order={order} company={company} contact={contact} sourceQuote={sourceQuote} />
        </div>
      )}
      {tab === "files" && <FilesTab order={order} />}
      {tab === "audit" && <AuditTab auditLog={order.auditLog || []} />}

      {builderState && <OrderBuilder mode={builderState.mode} order={order} onClose={() => setBuilderState(null)} onSaved={() => dispatch(fetchOrder(id))} />}
      {dialog === "logActivity" && <LogActivityDialog order={order} onClose={() => setDialog(null)} onDone={() => { setDialog(null); dispatch(fetchOrder(id)); }} />}
      {dialog === "submitReview" && <SubmitReviewDialog order={order} onClose={() => setDialog(null)} onDone={() => { setDialog(null); dispatch(submitForReview(order._id)); }} />}
      {dialog === "confirm" && <ConfirmDialog order={order} onClose={() => setDialog(null)} onDone={(body) => { setDialog(null); dispatch(confirmOrder({ id: order._id, ...body })); }} />}
      {dialog === "startProcessing" && <StartProcessingDialog order={order} onClose={() => setDialog(null)} onDone={(body) => { setDialog(null); dispatch(startProcessing({ id: order._id, ...body })); }} />}
      {dialog === "hold" && <HoldDialog order={order} onClose={() => setDialog(null)} onDone={(body) => { setDialog(null); dispatch(putOnHold({ id: order._id, ...body })); }} />}
      {dialog === "resume" && <ResumeDialog order={order} onClose={() => setDialog(null)} onDone={(body) => { setDialog(null); dispatch(resumeOrder({ id: order._id, ...body })); }} />}
      {dialog === "markFulfilled" && <ConfirmSimpleDialog title="Mark Fulfilled" text="Mark this Order as fully fulfilled?" onClose={() => setDialog(null)} onConfirm={() => { setDialog(null); dispatch(markFulfilled(order._id)); }} />}
      {dialog === "complete" && <CompleteDialog order={order} onClose={() => setDialog(null)} onDone={(body) => { setDialog(null); dispatch(markCompleted({ id: order._id, ...body })); }} />}
      {dialog === "cancel" && <CancelDetailDialog order={order} onClose={() => setDialog(null)} onDone={(body) => { setDialog(null); dispatch(cancelOrder({ id: order._id, ...body })); }} />}
      {dialog === "archive" && <ArchiveDetailDialog order={order} onClose={() => setDialog(null)} onDone={() => { setDialog(null); dispatch(fetchOrder(id)); }} />}
    </div>
  );
}

function StatusRail({ effStatus, onStepClick }) {
  const idx = ORDER_PROGRESSION.indexOf(effStatus === "Partially Fulfilled" ? "Processing" : effStatus);
  const isAlt = ["On Hold", "Cancelled"].includes(effStatus);
  const nextActionByStep = { Draft: "submitReview", "Pending Review": "confirm", Confirmed: "startProcessing", Processing: "markFulfilled", Fulfilled: "complete" };
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max text-xs">
        {ORDER_PROGRESSION.map((step, i) => {
          const reached = !isAlt && i <= idx;
          const isCurrent = !isAlt && step === (effStatus === "Partially Fulfilled" ? "Processing" : effStatus);
          const clickable = nextActionByStep[step] && i === idx + 1;
          return (
            <div key={step} className="flex items-center gap-1">
              <button type="button" disabled={!clickable} onClick={() => clickable && onStepClick(nextActionByStep[step])}
                className={`px-2.5 py-1 rounded-full border whitespace-nowrap ${isCurrent ? "bg-blue-700 border-blue-600 text-white" : reached ? "border-emerald-700 text-emerald-300" : clickable ? "border-gray-600 text-gray-300 hover:border-blue-600 hover:text-blue-300 cursor-pointer" : "border-gray-800 text-gray-600"}`}>
                {step}{effStatus === "Partially Fulfilled" && step === "Processing" && " (Partially Fulfilled)"}
              </button>
              {i < ORDER_PROGRESSION.length - 1 && <span className="text-gray-700">→</span>}
            </div>
          );
        })}
        {isAlt && <span className={`ml-2 px-2.5 py-1 rounded-full border whitespace-nowrap ${ORDER_STATUS_COLORS[effStatus]}`}>{effStatus} (alternative state)</span>}
      </div>
      <p className="text-[11px] text-gray-500 mt-2">Clicking an available next step opens a confirmation dialog — status never changes immediately.</p>
    </div>
  );
}

function EmptyPanel({ icon, text }) {
  const Icon = icon;
  return <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-500"><Icon size={22} className="mx-auto mb-2 text-gray-600" /><p className="text-sm">{text}</p></div>;
}
function Field({ label, value }) {
  return <div><dt className="text-xs text-gray-500">{label}</dt><dd className="text-gray-200">{value ?? "—"}</dd></div>;
}

function OverviewTab({ order, totals, progress, company, contact, deal, sourceQuote }) {
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Customer &amp; source</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Company" value={company ? <Link to={`/crm/companies/${company._id}`} className="text-blue-400 hover:underline">{company.name}</Link> : "—"} />
            <Field label="Contact" value={contact ? <Link to={`/crm/contacts/${contact._id}`} className="text-blue-400 hover:underline">{contact.name}</Link> : "—"} />
            <Field label="Deal" value={deal ? <Link to={`/crm/deals/${deal._id}`} className="text-blue-400 hover:underline">{deal.name}</Link> : "None"} />
            <Field label="Source Quote" value={sourceQuote ? <Link to={`/sales/quotes/${sourceQuote._id}`} className="text-blue-400 hover:underline">{sourceQuote.quoteNumber} (v{order.sourceQuoteVersion})</Link> : "None — manual Order"} />
            <Field label="Owner" value={order.ownerName || "Unassigned"} />
            <Field label="Order Type" value={order.orderType} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Pricing summary</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="One-Time Total" value={formatMoney(totals.oneTimeTotal, order.currency)} />
            <Field label="Recurring Total" value={formatMoney(totals.recurringTotal, order.currency)} />
            <Field label="Tax (estimate)" value={formatMoney(totals.tax, order.currency)} />
            <Field label="Grand Total" value={formatMoney(totals.grandTotal, order.currency)} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Fulfillment &amp; billing summary</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Fulfillment Progress" value={`${progress.toFixed(0)}%`} />
            <Field label="Requested Date" value={order.requestedDate ? formatDate(order.requestedDate) : "—"} />
            <Field label="Payment Terms" value={order.paymentTerms} />
            <Field label="Billing Schedule" value={order.billingSchedule} />
          </dl>
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Dates</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Order Date" value={formatDate(order.orderDate)} />
            <Field label="Confirmed Date" value={order.confirmedDate ? formatDate(order.confirmedDate) : "—"} />
            <Field label="Currency" value={order.currency} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Reference</h3>
          <dl className="space-y-2 text-sm"><Field label="Customer Reference" value={order.customerReference || "—"} /></dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Record</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Created" value={formatDateTime(order.createdAt)} />
            <Field label="Updated" value={formatDateTime(order.updatedAt)} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function LineItemsTab({ order }) {
  const lines = order.lineItems || [];
  if (lines.length === 0) return <EmptyPanel icon={Package} text="No line items on this Order." />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Prices and discounts below are frozen snapshots taken when this Order was created — later Price Book or catalog changes never update them.</p>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
            <th className="px-4 py-3 font-medium">Product/Service</th><th className="px-4 py-3 font-medium">Qty Ordered</th><th className="px-4 py-3 font-medium">Qty Fulfilled</th>
            <th className="px-4 py-3 font-medium">Remaining</th><th className="px-4 py-3 font-medium">Price Snapshot</th><th className="px-4 py-3 font-medium">Discount Snapshot</th>
            <th className="px-4 py-3 font-medium">Tax</th><th className="px-4 py-3 font-medium">Total</th><th className="px-4 py-3 font-medium">Billing</th><th className="px-4 py-3 font-medium">Fulfillment</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const remaining = l.lineKind === "Product" ? Math.max(0, l.quantity - l.quantityFulfilled) : null;
              const fulfillmentLabel = l.lineKind === "Product" ? l.deliveryStatus : `${l.completionPercentage}% complete`;
              return (
                <tr key={l._id} className="border-t border-gray-800">
                  <td className="px-4 py-3 font-medium">{l.catalogItemId ? <Link to={`/sales/products/${l.catalogItemId}`} className="text-blue-400 hover:underline">{l.name}</Link> : l.name}</td>
                  <td className="px-4 py-3 text-gray-300">{l.quantity}</td>
                  <td className="px-4 py-3 text-gray-300">{l.lineKind === "Product" ? l.quantityFulfilled : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{remaining ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(l.unitPrice, order.currency)}</td>
                  <td className="px-4 py-3 text-gray-300">{l.discountType ? (l.discountType === "Percentage" ? `${l.discountValue}%` : formatMoney(l.discountValue, order.currency)) : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{l.taxCategory}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(computeLineTotal(l), order.currency)}</td>
                  <td className="px-4 py-3 text-gray-300">{l.billingModel}{l.billingInterval ? ` (${l.billingInterval})` : ""}</td>
                  <td className="px-4 py-3 text-gray-300">{fulfillmentLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FulfillmentTab({ order, progress, dispatch, orderId }) {
  const [editingLine, setEditingLine] = useState(null);
  const [fulfillError, setFulfillError] = useState("");
  const lines = order.lineItems || [];

  const submitFulfillment = async (line, changes) => {
    setFulfillError("");
    const result = await dispatch(updateLineFulfillment({ id: orderId, lineId: line._id, ...changes }));
    if (updateLineFulfillment.rejected.match(result)) setFulfillError(result.payload);
    else { setEditingLine(null); dispatch(fetchOrder(orderId)); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-sm font-semibold">Overall progress</h3>
          <span className="text-sm font-medium">{progress.toFixed(0)}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="bg-emerald-600 h-2 rounded-full" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
        <p className="text-[11px] text-gray-500 mt-2">{ORDER_PROGRESS_EXPLANATION}</p>
      </div>
      {fulfillError && <p className="text-sm text-red-400">{fulfillError}</p>}
      {lines.map((line) => {
        const lineProgress = computeLineProgress(line);
        const isEditing = editingLine === line._id;
        return (
          <div key={line._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-2">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <p className="font-medium text-sm">{line.name} <span className="text-xs text-gray-500">({line.lineKind})</span></p>
              <button onClick={() => setEditingLine(isEditing ? null : line._id)} className="text-xs text-blue-400 hover:underline">{isEditing ? "Cancel" : "Update"}</button>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1.5" role="progressbar" aria-valuenow={lineProgress} aria-valuemin={0} aria-valuemax={100}>
              <div className="bg-emerald-600 h-1.5 rounded-full" style={{ width: `${lineProgress}%` }} />
            </div>
            <p className="text-xs text-gray-400">{lineProgress.toFixed(0)}% complete</p>

            {line.lineKind === "Product" ? (
              <dl className="grid sm:grid-cols-4 gap-2 text-xs">
                <Field label="Ordered" value={line.quantity} /><Field label="Fulfilled" value={line.quantityFulfilled} />
                <Field label="Remaining" value={Math.max(0, line.quantity - line.quantityFulfilled)} /><Field label="Delivery Status" value={line.deliveryStatus} />
                <Field label="Requested Date" value={order.requestedDate ? formatDate(order.requestedDate) : "—"} /><Field label="Completed Date" value={line.completedDate ? formatDate(line.completedDate) : "—"} />
                <Field label="Delivery Reference" value={line.deliveryReferencePreview || "—"} />
              </dl>
            ) : (
              <dl className="grid sm:grid-cols-4 gap-2 text-xs">
                <Field label="Start Date" value={line.serviceStartDate ? formatDate(line.serviceStartDate) : "—"} /><Field label="Responsible Owner" value={line.responsibleOwnerName || "Unassigned"} />
                <Field label="Setup Status" value={line.setupStatus} /><Field label="Activation" value={line.activationStatus} />
                <Field label="Completion %" value={`${line.completionPercentage}%`} /><Field label="Next Milestone" value={line.nextMilestone || "—"} />
              </dl>
            )}
            {line.fulfillmentNotes?.length > 0 && (
              <div className="text-xs text-gray-400 space-y-0.5">
                {line.fulfillmentNotes.slice(-3).map((n) => <p key={n._id}>&quot;{n.text}&quot; — {n.author}, {formatDate(n.at)}</p>)}
              </div>
            )}
            {isEditing && <FulfillmentUpdateForm line={line} onSubmit={(changes) => submitFulfillment(line, changes)} />}
          </div>
        );
      })}
    </div>
  );
}

function FulfillmentUpdateForm({ line, onSubmit }) {
  const [qty, setQty] = useState(line.quantityFulfilled);
  const [pct, setPct] = useState(line.completionPercentage);
  const [note, setNote] = useState("");
  const [fulfillmentDate, setFulfillmentDate] = useState(new Date().toISOString().slice(0, 10));
  const remaining = line.lineKind === "Product" ? Math.max(0, line.quantity - Number(qty || 0)) : null;
  return (
    <div className="bg-gray-800/40 rounded-lg p-3 space-y-2 text-xs">
      {line.lineKind === "Product" ? (
        <div className="grid sm:grid-cols-3 gap-2">
          <div><label className="block text-gray-500 mb-0.5">Previously fulfilled</label><p className="text-gray-300 pt-1.5">{line.quantityFulfilled}</p></div>
          <div><label htmlFor={`fulfill-qty-${line._id}`} className="block text-gray-500 mb-0.5">New fulfillment amount</label><input id={`fulfill-qty-${line._id}`} type="number" min="0" max={line.quantity} value={qty} onChange={(e) => setQty(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1" /></div>
          <div><label className="block text-gray-500 mb-0.5">Remaining</label><p className="text-gray-300 pt-1.5">{remaining}</p></div>
        </div>
      ) : (
        <div>
          <label htmlFor={`fulfill-pct-${line._id}`} className="block text-gray-500 mb-0.5">Completion percentage</label>
          <input id={`fulfill-pct-${line._id}`} type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} className="w-32 bg-gray-900 border border-gray-700 rounded px-2 py-1" />
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-2">
        <div><label htmlFor={`fulfill-date-${line._id}`} className="block text-gray-500 mb-0.5">Fulfillment date</label><input id={`fulfill-date-${line._id}`} type="date" value={fulfillmentDate} onChange={(e) => setFulfillmentDate(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1" /></div>
        <div><label htmlFor={`fulfill-note-${line._id}`} className="block text-gray-500 mb-0.5">Note</label><input id={`fulfill-note-${line._id}`} value={note} onChange={(e) => setNote(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1" /></div>
      </div>
      <button
        onClick={() => onSubmit(line.lineKind === "Product" ? { quantityFulfilled: Number(qty), fulfillmentDate, note } : { completionPercentage: Number(pct), fulfillmentDate, note })}
        className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-xs font-medium"
      >
        Save Fulfillment Update
      </button>
    </div>
  );
}

function BillingTab({ order, totals, contact, onRequestInvoice }) {
  const isAwaiting = isAwaitingBillingHandoff(order);
  return (
    <div className="space-y-4">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="Billing Contact" value={contact?.name || "Same as primary contact"} />
          <Field label="Billing Address" value={order.billingAddress ? `${order.billingAddress.line1}, ${order.billingAddress.city}` : "Same as delivery address"} />
          <Field label="Payment Terms" value={order.paymentTerms} />
          <Field label="Billing Schedule" value={order.billingSchedule} />
        </dl>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="One-Time Amount" value={formatMoney(totals.oneTimeTotal, order.currency)} />
          <Field label="Recurring Amount" value={formatMoney(totals.recurringTotal, order.currency)} />
          <Field label="Tax" value={formatMoney(totals.tax, order.currency)} />
          <Field label="Grand Total" value={formatMoney(totals.grandTotal, order.currency)} />
        </dl>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold">Invoice handoff readiness</h3>
        {order.invoiceRequestedAt ? (
          <p className="text-sm text-emerald-300">{BACKEND_CRM_SALES_MODE_ENABLED
            ? <>Invoice requested on {formatDate(order.invoiceRequestedAt)}. A draft invoice was created in <Link to="/finance/invoices" className="underline">Finance</Link> for approval.</>
            : <>Invoice request previewed on {formatDate(order.invoiceRequestedAt)}. No invoice was created in this demo.</>}</p>
        ) : (
          <>
            <p className="text-sm text-gray-400">{isAwaiting ? "This Order is fulfilled and awaiting billing handoff." : "Not yet ready — the Order isn't Fulfilled or Completed."}</p>
            <button onClick={onRequestInvoice} className="px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm">{BACKEND_CRM_SALES_MODE_ENABLED ? "Request Invoice" : "Preview Invoice Request"}</button>
          </>
        )}
        <p className="text-[11px] text-gray-500">Invoices are made in Finance.</p>
      </div>
    </div>
  );
}

function RelatedRecordsTab({ deal, sourceQuote, order }) {
  const navigate = useNavigate();
  const relatedContracts = contractsForOrder(order._id);
  return (
    <div className="space-y-4">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <dl className="space-y-2 text-sm">
          <Field label="Deal" value={deal ? <Link to={`/crm/deals/${deal._id}`} className="text-blue-400 hover:underline">{deal.name}</Link> : "None"} />
          <Field label="Quote" value={sourceQuote ? <Link to={`/sales/quotes/${sourceQuote._id}`} className="text-blue-400 hover:underline">{sourceQuote.quoteNumber}</Link> : "None"} />
        </dl>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Contract{relatedContracts.length === 1 ? "" : "s"}</h3>
          <button onClick={() => navigate(`/sales/contracts?fromOrder=${order._id}`)} className="text-xs text-blue-400 hover:underline">Generate Contract from this Order</button>
        </div>
        {relatedContracts.length === 0 ? (
          <p className="text-sm text-gray-500">No Contract has been generated from this Order yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {relatedContracts.map((c) => (
              <li key={c._id} className="flex items-center justify-between">
                <Link to={`/sales/contracts/${c._id}`} className="text-blue-400 hover:underline">{c.contractNumber}</Link>
                <span className="text-xs text-gray-400">{getContractEffectiveStatus(c)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-2">Future previews</h3>
        <ul className="text-sm text-gray-500 space-y-1">{RELATED_RECORD_PREVIEWS.map((p) => <li key={p}>{p} — route not yet implemented, no record created</li>)}</ul>
      </div>
    </div>
  );
}

function ActivityTab({ activity }) {
  if (activity.length === 0) return <EmptyPanel icon={Shield} text="No activity recorded yet." />;
  return (
    <ul className="space-y-2">
      {[...activity].reverse().map((a) => (
        <li key={a._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 text-sm flex justify-between"><span>{a.description}</span><span className="text-gray-500 text-xs">{formatDateTime(a.at)} · {a.actor}</span></li>
      ))}
    </ul>
  );
}

function FilesTab({ order }) {
  const files = order.files || [];
  if (files.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyPanel icon={Shield} text="No files attached yet — purchase orders, customer instructions, delivery/service documents and attachments can be previewed here." />
        <div className="border-2 border-dashed border-gray-700 rounded-xl p-6 text-center text-gray-500 text-sm">Drag and drop a file here, or browse (upload preview only)</div>
      </div>
    );
  }
  return <div className="bg-gray-900/40 border border-gray-800 rounded-xl divide-y divide-gray-800">{files.map((f) => (<div key={f._id} className="flex items-center justify-between p-3 text-sm"><span>{f.name}</span><span className="text-gray-500 text-xs">{formatDate(f.uploadedAt)}</span></div>))}</div>;
}

function AuditTab({ auditLog }) {
  if (auditLog.length === 0) return <EmptyPanel icon={Shield} text="No audit events yet." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr><th className="px-4 py-3 font-medium">Actor</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Field</th><th className="px-4 py-3 font-medium">Previous</th><th className="px-4 py-3 font-medium">New</th><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Reason</th></tr></thead>
        <tbody>{[...auditLog].reverse().map((e) => (
          <tr key={e._id} className="border-t border-gray-800">
            <td className="px-4 py-3 text-gray-300">{e.actor}</td><td className="px-4 py-3 text-gray-300 capitalize">{e.action}</td><td className="px-4 py-3 text-gray-300">{e.field || "—"}</td>
            <td className="px-4 py-3 text-gray-400">{String(e.before ?? "—")}</td><td className="px-4 py-3 text-gray-300">{String(e.after ?? "—")}</td>
            <td className="px-4 py-3 text-gray-500">{formatDateTime(e.at)}</td><td className="px-4 py-3 text-amber-300">{e.reason || "—"}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Visual preview only — backend audit integration is a later phase.</p>
    </div>
  );
}

// ---- Status-transition & utility dialogs ----
function DialogShell({ title, ariaLabel, onClose, children, onSubmit, submitLabel, submitDisabled, submitClass = "bg-blue-700 hover:bg-blue-800" }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label={ariaLabel || title} onSubmit={(e) => { e.preventDefault(); onSubmit(); }} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-3 text-white max-h-[85vh] overflow-y-auto">
        <h2 className="text-lg font-bold">{title}</h2>
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={submitDisabled} className={`px-4 py-2 rounded-lg disabled:opacity-50 text-sm font-medium ${submitClass}`}>{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

function LogActivityDialog({ order, onClose, onDone }) {
  const dispatch = useDispatch();
  const [note, setNote] = useState("");
  return (
    <DialogShell title="Log Activity" onClose={onClose} submitLabel="Add" submitDisabled={!note.trim()} onSubmit={async () => {
      await dispatch(updateOrder({ id: order._id, changes: { internalNote: `${order.internalNote ? order.internalNote + "\n" : ""}${note}` } }));
      onDone();
    }}>
      <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Note" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
    </DialogShell>
  );
}

function SubmitReviewDialog({ order, onClose, onDone }) {
  const totals = computeOrderTotals(order);
  return (
    <DialogShell title="Submit for Review" onClose={onClose} submitLabel="Submit" onSubmit={onDone}>
      <p className="text-xs text-gray-500">Preview check before submitting:</p>
      <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
        <li>Customer: {order.companyId ? "set" : "missing"}</li>
        <li>Contact: {order.contactId ? "set" : "missing"}</li>
        <li>Line items: {order.lineItems.length}</li>
        <li>Currency: {order.currency}</li>
        <li>Pricing: {formatMoney(totals.grandTotal, order.currency)}</li>
        <li>Requested date: {order.requestedDate ? formatDate(order.requestedDate) : "not set"}</li>
        <li>Fulfillment info: {order.orderType === "Service Order" || order.serviceAddress?.line1 ? "complete" : "incomplete"}</li>
        <li>Billing info: {order.paymentTerms}, {order.billingSchedule}</li>
      </ul>
    </DialogShell>
  );
}

function ConfirmDialog({ order, onClose, onDone }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const [confirmedDate, setConfirmedDate] = useState(new Date().toISOString().slice(0, 10));
  const [ownerId, setOwnerId] = useState(order.ownerId || "");
  const [internalNote, setInternalNote] = useState("");
  return (
    <DialogShell title="Confirm Order" onClose={onClose} submitLabel="Confirm" submitDisabled={!confirmedDate || !internalNote.trim()} onSubmit={() => onDone({ confirmedDate: new Date(confirmedDate).toISOString(), ownerId, internalNote })}>
      <div><label htmlFor="confirm-date" className="block text-sm mb-1 text-gray-300">Confirmed Delivery/Start Date</label><input id="confirm-date" type="date" required value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
      <div><label htmlFor="confirm-owner" className="block text-sm mb-1 text-gray-300">Owner</label><select id="confirm-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm"><option value="">Unassigned</option>{crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div><label htmlFor="confirm-note" className="block text-sm mb-1 text-gray-300">Internal Note</label><textarea id="confirm-note" required value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" /></div>
    </DialogShell>
  );
}

function StartProcessingDialog({ order, onClose, onDone }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const [ownerId, setOwnerId] = useState(order.ownerId || "");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  return (
    <DialogShell title="Start Processing" onClose={onClose} submitLabel="Start Processing" submitDisabled={!ownerId || !startDate || !note.trim()} onSubmit={() => onDone({ ownerId, startDate: new Date(startDate).toISOString(), note })}>
      <div><label htmlFor="proc-owner" className="block text-sm mb-1 text-gray-300">Responsible Owner</label><select id="proc-owner" required value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm"><option value="">Select owner...</option>{crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div><label htmlFor="proc-date" className="block text-sm mb-1 text-gray-300">Start Date</label><input id="proc-date" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
      <div><label htmlFor="proc-note" className="block text-sm mb-1 text-gray-300">Initial Fulfillment Note</label><textarea id="proc-note" required value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" /></div>
    </DialogShell>
  );
}

function HoldDialog({ order, onClose, onDone }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const [reason, setReason] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [ownerId, setOwnerId] = useState(order.ownerId || "");
  return (
    <DialogShell title="Put On Hold" onClose={onClose} submitLabel="Put On Hold" submitClass="bg-orange-700 hover:bg-orange-800" submitDisabled={!reason.trim()} onSubmit={() => onDone({ reason, reviewDate: reviewDate ? new Date(reviewDate).toISOString() : null, ownerId })}>
      <div><label htmlFor="hold-reason" className="block text-sm mb-1 text-gray-300">Reason</label><textarea id="hold-reason" autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" /></div>
      <div><label htmlFor="hold-review" className="block text-sm mb-1 text-gray-300">Review Date</label><input id="hold-review" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
      <div><label htmlFor="hold-owner" className="block text-sm mb-1 text-gray-300">Owner</label><select id="hold-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm"><option value="">Unassigned</option>{crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
    </DialogShell>
  );
}

function ResumeDialog({ onClose, onDone }) {
  const [resumeDate, setResumeDate] = useState(new Date().toISOString().slice(0, 10));
  const [targetStatus, setTargetStatus] = useState("Processing");
  const [note, setNote] = useState("");
  return (
    <DialogShell title="Resume Order" onClose={onClose} submitLabel="Resume" submitDisabled={!resumeDate || !targetStatus || !note.trim()} onSubmit={() => onDone({ resumeDate: new Date(resumeDate).toISOString(), targetStatus, note })}>
      <div><label htmlFor="resume-date" className="block text-sm mb-1 text-gray-300">Resume Date</label><input id="resume-date" type="date" required value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
      <div><label htmlFor="resume-status" className="block text-sm mb-1 text-gray-300">Target Status</label><select id="resume-status" value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">{["Pending Review", "Confirmed", "Processing"].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      <div><label htmlFor="resume-note" className="block text-sm mb-1 text-gray-300">Note</label><textarea id="resume-note" required value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" /></div>
    </DialogShell>
  );
}

function CancelDetailDialog({ order, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const totals = computeOrderTotals(order);
  return (
    <DialogShell title="Cancel Order" onClose={onClose} submitLabel="Cancel Order" submitClass="bg-red-700 hover:bg-red-800" submitDisabled={!reason.trim()} onSubmit={() => onDone({ reason, effectiveDate: new Date(effectiveDate).toISOString() })}>
      <div><label htmlFor="cancel-reason" className="block text-sm mb-1 text-gray-300">Cancellation Reason</label><textarea id="cancel-reason" autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" /></div>
      <div><label htmlFor="cancel-date" className="block text-sm mb-1 text-gray-300">Effective Date</label><input id="cancel-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
      <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 space-y-1">
        <p>The customer is not notified automatically. Let them know yourself.</p>
        <p>Billing-impact preview: {formatMoney(totals.grandTotal, order.currency)} will no longer be billed.</p>
        <p>Fulfillment-impact preview: any in-progress fulfillment work will be halted.</p>
      </div>
    </DialogShell>
  );
}

function CompleteDialog({ onClose, onDone }) {
  const [fulfillmentComplete, setFulfillmentComplete] = useState(false);
  const [completionDate, setCompletionDate] = useState(new Date().toISOString().slice(0, 10));
  const [completionNote, setCompletionNote] = useState("");
  const [noRemainingIssues, setNoRemainingIssues] = useState(false);
  return (
    <DialogShell title="Mark Completed" onClose={onClose} submitLabel="Mark Completed" submitDisabled={!fulfillmentComplete || !noRemainingIssues || !completionNote.trim()} onSubmit={() => onDone({ completionDate: new Date(completionDate).toISOString(), completionNote })}>
      <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={fulfillmentComplete} onChange={(e) => setFulfillmentComplete(e.target.checked)} /> Fulfillment is complete</label>
      <div><label htmlFor="complete-date" className="block text-sm mb-1 text-gray-300">Completion Date</label><input id="complete-date" type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" /></div>
      <div><label htmlFor="complete-note" className="block text-sm mb-1 text-gray-300">Completion Note</label><textarea id="complete-note" value={completionNote} onChange={(e) => setCompletionNote(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" /></div>
      <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={noRemainingIssues} onChange={(e) => setNoRemainingIssues(e.target.checked)} /> I confirm there are no remaining issues</label>
    </DialogShell>
  );
}

function ConfirmSimpleDialog({ title, text, onClose, onConfirm }) {
  return <DialogShell title={title} onClose={onClose} submitLabel="Confirm" onSubmit={onConfirm}><p className="text-sm text-gray-400">{text}</p></DialogShell>;
}

function ArchiveDetailDialog({ order, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  return (
    <DialogShell title={`Archive "${order.orderNumber}"`} onClose={onClose} submitLabel="Archive" submitClass="bg-red-700 hover:bg-red-800" submitDisabled={!reason.trim()} onSubmit={() => { dispatch(archiveOrder({ id: order._id, reason })); onDone(); }}>
      <p className="text-sm text-gray-400">Archived Orders remain visible in related Quote and Deal history. Shared Company, Contact, Deal and Quote records are never removed.</p>
      <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
    </DialogShell>
  );
}
