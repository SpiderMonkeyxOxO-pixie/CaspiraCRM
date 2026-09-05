import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, useNavigate, Link } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Pencil, Copy, Archive, RotateCcw, MoreHorizontal, ArrowLeft, Printer, Download,
  FileText, Layers, AlertTriangle, Shield, Send, ThumbsUp, ThumbsDown, MessageSquare, Scale,
} from "lucide-react";
import {
  fetchQuote, archiveQuote, restoreQuote, submitForReview, approveReview, rejectReview,
  requestReviewChanges, cancelQuote, previewSend, simulateCustomerResponse,
  CUSTOMER_RESPONSE_TYPES, HANDOFF_ACTIONS,
} from "../../../redux/sales/quotesSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchPriceBooks } from "../../../redux/sales/priceBooksSlice";
import {
  getEffectiveStatus, isExpiringSoon, computeQuoteTotals, computeLineTotal, computeQuoteWarnings, getQuoteFamily,
} from "../../../Helpers/mockQuoteData";
import { findCatalogItem } from "../../../Helpers/mockCatalogData";
import { orders } from "../../../Helpers/mockSalesData";
import { getEffectiveStatus as getOrderEffectiveStatus, computeOrderTotals } from "../../../Helpers/mockOrderData";
import { contractsForQuote, getEffectiveStatus as getContractEffectiveStatus, computeContractTotals } from "../../../Helpers/mockContractData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatDate, formatDateTime, QUOTE_STATUS_COLORS, APPROVAL_STATUS_COLORS, LOCKED_FOR_EDIT_STATUSES } from "./quoteUtils";
import QuoteBuilder from "./QuoteBuilder";
import QuoteDocumentPreview from "./QuoteDocumentPreview";
import QuoteCompareDrawer from "./QuoteCompareDrawer";

const TABS = ["overview", "items", "document", "approvals", "activity", "versions", "files", "audit"];
const TAB_LABELS = {
  overview: "Overview", items: "Line Items", document: "Document Preview", approvals: "Approvals",
  activity: "Activity", versions: "Versions", files: "Files", audit: "Audit",
};

export default function QuoteDetail() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const quote = useSelector((s) => s.quotes.current);
  const currentNotFound = useSelector((s) => s.quotes.currentNotFound);
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);

  const [tab, setTab] = useState("overview");
  const [builderState, setBuilderState] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [showCompare, setShowCompare] = useState(null);
  const [showHandoff, setShowHandoff] = useState(null);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);

  useEffect(() => {
    dispatch(fetchQuote(id)); dispatch(fetchCompanies()); dispatch(fetchContacts()); dispatch(fetchDeals()); dispatch(fetchPriceBooks());
  }, [dispatch, id]);

  if (currentNotFound) {
    return (
      <div className="p-6 text-white">
        <button onClick={() => navigate("/sales/quotes")} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4"><ArrowLeft size={15} /> Back to Quotes</button>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-400">
          <p className="mb-1">This Quote couldn&apos;t be found.</p>
          <p className="text-sm text-gray-500">It may have been part of an earlier session — this in-memory data resets on a full page reload.</p>
        </div>
      </div>
    );
  }
  if (!quote) {
    return (
      <div className="p-6 text-white">
        <div className="animate-pulse space-y-4"><div className="h-4 w-40 bg-gray-800 rounded" /><div className="h-8 w-72 bg-gray-800 rounded" /><div className="h-32 bg-gray-900/40 border border-gray-800 rounded-xl" /></div>
      </div>
    );
  }

  const effStatus = getEffectiveStatus(quote);
  const totals = computeQuoteTotals(quote);
  const company = companies.find((c) => c._id === quote.companyId);
  const contact = allContacts.find((c) => c._id === quote.primaryContactId);
  const deal = deals.find((d) => d._id === quote.dealId);
  const family = getQuoteFamily(quote.rootId);
  const relatedOrders = orders.filter((o) => o.sourceQuoteId === quote._id);
  const relatedContracts = contractsForQuote(quote._id);
  const canEdit = !LOCKED_FOR_EDIT_STATUSES.includes(effStatus);
  const canSubmit = effStatus === "Draft";
  const canSend = ["Approved", "Draft", "Internal Review"].includes(effStatus);
  const canRespond = ["Preview Sent", "Preview Viewed"].includes(effStatus);
  const canCancel = !["Cancelled", "Superseded", "Preview Accepted"].includes(effStatus);
  const isApprovalPending = effStatus === "Approval Pending";

  const downloadPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text(`Quote ${quote.quoteNumber} (v${quote.version}) — PREVIEW`, 14, 16);
    doc.setFontSize(10); doc.text(`${company?.name || "—"} · ${contact?.name || "—"}`, 14, 24);
    doc.text(`Issued ${formatDate(quote.issueDate)} · Valid until ${quote.validUntilDate ? formatDate(quote.validUntilDate) : "—"}`, 14, 30);
    autoTable(doc, {
      startY: 36,
      head: [["Item", "Qty", "Unit Price", "Discount", "Total"]],
      body: quote.lineItems.filter((l) => l.included !== false).map((l) => [
        l.name, l.quantity, formatMoney(l.unitPrice, quote.currency),
        l.discountType ? (l.discountType === "Percentage" ? `${l.discountValue}%` : formatMoney(l.discountValue, quote.currency)) : "—",
        formatMoney(computeLineTotal(l), quote.currency),
      ]),
    });
    const finalY = doc.lastAutoTable.finalY + 8;
    doc.text(`Grand Total: ${formatMoney(totals.grandTotal, quote.currency)}`, 14, finalY);
    doc.setFontSize(8); doc.text("This is a frontend preview document — not a final production Quote.", 14, finalY + 10);
    doc.save(`${quote.quoteNumber}-v${quote.version}-PREVIEW.pdf`);
  };

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/sales/dashboard" className="hover:text-gray-300">Sales</Link> / <Link to="/sales/quotes" className="hover:text-gray-300">Quotes</Link> / <span className="text-gray-300">{quote.quoteNumber}</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-2xl font-bold">{quote.quoteNumber} <span className="text-gray-500 font-normal text-lg">v{quote.version}</span></h1>
            <span className={`px-2 py-1 rounded-full text-xs border ${QUOTE_STATUS_COLORS[effStatus]}`}>{effStatus}</span>
            <span className={`px-2 py-1 rounded-full text-xs border ${APPROVAL_STATUS_COLORS[quote.approval?.status] || APPROVAL_STATUS_COLORS["Not Required"]}`}>{quote.approval?.status || "Not Required"}</span>
            {isExpiringSoon(quote) && <span className="flex items-center gap-1 text-xs text-amber-400"><AlertTriangle size={13} /> Expiring soon</span>}
          </div>
          <p className="text-sm text-gray-400">{quote.title} · {company?.name || "No company"} · {contact?.name || "No contact"} {deal && <>· <Link to={`/crm/deals/${deal._id}`} className="text-blue-400 hover:underline">{deal.name}</Link></>}</p>
          <p className="text-sm text-gray-300 mt-1">{formatMoney(totals.grandTotal, quote.currency)} · Valid until {quote.validUntilDate ? formatDate(quote.validUntilDate) : "—"} · Owner: {quote.ownerName || "Unassigned"}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canEdit && <button onClick={() => setBuilderState({ mode: "edit" })} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium"><Pencil size={15} /> Edit Draft</button>}
          <button onClick={() => setTab("document")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><FileText size={15} /> Preview Document</button>
          <button onClick={() => setBuilderState({ mode: "newVersion" })} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">Create New Version</button>
          {canSubmit && <button onClick={() => dispatch(submitForReview(quote._id))} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">Submit for Review</button>}
          <div className="relative">
            <button onClick={() => setRowMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={rowMenuOpen} aria-label="More actions" className="p-2 rounded-lg border border-gray-700 hover:bg-gray-800"><MoreHorizontal size={16} /></button>
            {rowMenuOpen && (
              <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-56 shadow-xl">
                <button role="menuitem" onClick={() => { setBuilderState({ mode: "duplicate" }); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><Copy size={13} /> Duplicate</button>
                {isApprovalPending && <button role="menuitem" onClick={() => { setTab("approvals"); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><ThumbsUp size={13} /> Preview Approve / Reject</button>}
                {canSend && <button role="menuitem" onClick={() => { setShowSend(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><Send size={13} /> Preview Send</button>}
                {canRespond && <button role="menuitem" onClick={() => { setShowResponse(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><MessageSquare size={13} /> Preview Customer Response</button>}
                {canCancel && <button role="menuitem" onClick={() => { setShowCancel(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Cancel</button>}
                {quote.archived ? (
                  <button role="menuitem" onClick={() => { dispatch(restoreQuote(quote._id)); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><RotateCcw size={13} /> Restore</button>
                ) : (
                  <button role="menuitem" onClick={() => { setShowArchive(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5 text-red-300"><Archive size={13} /> Archive</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {effStatus === "Preview Accepted" && (
        <div className="bg-emerald-900/15 border border-emerald-800/30 rounded-xl p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-emerald-100">This Quote is Preview Accepted. Possible next steps (previews only — no downstream records are created unless noted):</p>
          <div className="flex gap-2 flex-wrap">
            {HANDOFF_ACTIONS.map((a) => (
              <button key={a} onClick={() => {
                if (a === "Create Order") navigate(`/sales/orders?fromQuote=${quote._id}`);
                else if (a === "Prepare Contract") navigate(`/sales/contracts?fromQuote=${quote._id}`);
                else setShowHandoff(a);
              }} className="px-3 py-1.5 rounded-lg border border-emerald-700 text-emerald-200 hover:bg-emerald-900/30 text-xs">{a}</button>
            ))}
          </div>
        </div>
      )}
      {relatedOrders.length > 0 && (
        <div className="bg-blue-900/15 border border-blue-800/30 rounded-xl p-4 mb-4 space-y-2">
          <p className="text-sm text-blue-100 font-medium">Related Order{relatedOrders.length === 1 ? "" : "s"}</p>
          {relatedOrders.map((o) => (
            <div key={o._id} className="flex items-center justify-between text-sm">
              <Link to={`/sales/orders/${o._id}`} className="text-blue-300 hover:underline">{o.orderNumber}</Link>
              <span className="text-xs text-gray-400">{getOrderEffectiveStatus(o)} · {formatMoney(computeOrderTotals(o).grandTotal, o.currency)}</span>
            </div>
          ))}
        </div>
      )}
      {relatedContracts.length > 0 && (
        <div className="bg-violet-900/15 border border-violet-800/30 rounded-xl p-4 mb-4 space-y-2">
          <p className="text-sm text-violet-100 font-medium">Related Contract{relatedContracts.length === 1 ? "" : "s"}</p>
          {relatedContracts.map((c) => (
            <div key={c._id} className="flex items-center justify-between text-sm">
              <Link to={`/sales/contracts/${c._id}`} className="text-violet-300 hover:underline">{c.contractNumber}</Link>
              <span className="text-xs text-gray-400">{getContractEffectiveStatus(c)} · {formatMoney(computeContractTotals(c).grandTotal, c.currency)}</span>
            </div>
          ))}
        </div>
      )}
      {effStatus === "Expired" && (
        <div className="bg-orange-900/15 border border-orange-800/30 rounded-xl p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-orange-100">This Quote expired on {formatDate(quote.validUntilDate)}. Preview Accept is disabled — the original Quote is preserved.</p>
          <button onClick={() => setBuilderState({ mode: "newVersion" })} className="px-3 py-1.5 rounded-lg border border-orange-700 text-orange-200 hover:bg-orange-900/30 text-xs">Create New Version</button>
        </div>
      )}

      <nav className="flex gap-1 border-b border-gray-800 mb-4 overflow-x-auto" aria-label="Quote detail tabs">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}
            className={`px-3 py-2 text-sm whitespace-nowrap rounded-t-lg ${tab === t ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab quote={quote} totals={totals} company={company} contact={contact} deal={deal} />}
      {tab === "items" && <LineItemsTab quote={quote} totals={totals} />}
      {tab === "document" && (
        <div className="space-y-3">
          <div className="flex gap-2 justify-end print:hidden">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm"><Printer size={14} /> Print Preview</button>
            <button onClick={downloadPdf} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm"><Download size={14} /> Download Preview PDF</button>
          </div>
          <style>{"@media print { body * { visibility: hidden; } #quote-print-doc, #quote-print-doc * { visibility: visible; } #quote-print-doc { position: absolute; left: 0; top: 0; width: 100%; } }"}</style>
          <QuoteDocumentPreview id="quote-print-doc" quote={quote} company={company} contact={contact} ownerName={quote.ownerName} layout={quote.documentLayout} />
        </div>
      )}
      {tab === "approvals" && <ApprovalsTab quote={quote} onApprove={(c) => dispatch(approveReview({ id: quote._id, comment: c }))} onReject={(c) => dispatch(rejectReview({ id: quote._id, comment: c }))} onRequestChanges={(c) => dispatch(requestReviewChanges({ id: quote._id, comment: c }))} />}
      {tab === "activity" && <ActivityTab activity={quote.activity || []} />}
      {tab === "versions" && <VersionsTab family={family} currentId={quote._id} onCompare={(ids) => setShowCompare(ids)} />}
      {tab === "files" && <FilesTab quote={quote} />}
      {tab === "audit" && <AuditTab auditLog={quote.auditLog || []} />}

      {builderState && (
        <QuoteBuilder mode={builderState.mode} quote={quote} onClose={() => setBuilderState(null)} onSaved={() => dispatch(fetchQuote(id))} />
      )}
      {showArchive && <ArchiveDetailDialog quote={quote} onClose={() => setShowArchive(false)} onDone={() => { setShowArchive(false); dispatch(fetchQuote(id)); }} />}
      {showCancel && <CancelDetailDialog quote={quote} onClose={() => setShowCancel(false)} onDone={() => { setShowCancel(false); dispatch(fetchQuote(id)); }} />}
      {showSend && <SendDetailDialog quote={quote} onClose={() => setShowSend(false)} onDone={() => { setShowSend(false); dispatch(fetchQuote(id)); }} />}
      {showResponse && <ResponseDetailDialog quote={quote} onClose={() => setShowResponse(false)} onDone={() => { setShowResponse(false); dispatch(fetchQuote(id)); }} />}
      {showCompare && <QuoteCompareDrawer quoteIds={showCompare} onClose={() => setShowCompare(null)} />}
      {showHandoff && <HandoffPreviewDialog action={showHandoff} onClose={() => setShowHandoff(null)} />}
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

function OverviewTab({ quote, totals, company, contact, deal }) {
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Customer &amp; Deal</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Company" value={company ? <Link to={`/crm/companies/${company._id}`} className="text-blue-400 hover:underline">{company.name}</Link> : "—"} />
            <Field label="Contact" value={contact ? <Link to={`/crm/contacts/${contact._id}`} className="text-blue-400 hover:underline">{contact.name}</Link> : "—"} />
            <Field label="Deal" value={deal ? <Link to={`/crm/deals/${deal._id}`} className="text-blue-400 hover:underline">{deal.name}</Link> : "None"} />
            <Field label="Owner" value={quote.ownerName || "Unassigned"} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Pricing summary</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Subtotal" value={formatMoney(totals.subtotal, quote.currency)} />
            <Field label="Overall Discount" value={formatMoney(totals.overallDiscountAmount, quote.currency)} />
            <Field label="Tax (preview)" value={formatMoney(totals.tax, quote.currency)} />
            <Field label="Grand Total" value={formatMoney(totals.grandTotal, quote.currency)} />
            <Field label="One-Time Total" value={formatMoney(totals.oneTimeTotal, quote.currency)} />
            <Field label="Monthly Recurring" value={formatMoney(totals.monthlyRecurringTotal, quote.currency)} />
            <Field label="Annual Recurring" value={formatMoney(totals.annualRecurringTotal, quote.currency)} />
            <Field label="Usage-Based Estimate" value={formatMoney(totals.usageBasedEstimate, quote.currency)} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Commercial terms</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Payment Terms" value={quote.paymentTerms} />
            <Field label="Billing Schedule" value={quote.billingSchedule} />
          </dl>
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Dates &amp; scope</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Issue Date" value={formatDate(quote.issueDate)} />
            <Field label="Valid Until" value={quote.validUntilDate ? formatDate(quote.validUntilDate) : "—"} />
            <Field label="Currency" value={quote.currency} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Status</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Status" value={getEffectiveStatus(quote)} />
            <Field label="Approval State" value={quote.approval?.status || "Not Required"} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Record</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Created" value={formatDateTime(quote.createdAt)} />
            <Field label="Updated" value={formatDateTime(quote.updatedAt)} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function LineItemsTab({ quote, totals }) {
  const lines = quote.lineItems || [];
  if (lines.length === 0) return <EmptyPanel icon={Layers} text="No line items on this Quote." />;
  return (
    <div className="space-y-3">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
            <th className="px-4 py-3 font-medium">Product</th><th className="px-4 py-3 font-medium">Qty</th><th className="px-4 py-3 font-medium">Unit</th>
            <th className="px-4 py-3 font-medium">List Price</th><th className="px-4 py-3 font-medium">Price Book Price</th><th className="px-4 py-3 font-medium">Final Unit Price</th>
            <th className="px-4 py-3 font-medium">Discount</th><th className="px-4 py-3 font-medium">Tax</th><th className="px-4 py-3 font-medium">Total</th><th className="px-4 py-3 font-medium">Billing</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const catalogItem = l.catalogItemId ? findCatalogItem(l.catalogItemId) : null;
              return (
                <tr key={l._id} className={`border-t border-gray-800 ${l.included === false ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium">{catalogItem ? <Link to={`/sales/products/${catalogItem._id}`} className="text-blue-400 hover:underline">{l.name}</Link> : l.name}
                    {l.isOverridden && <span title={l.overrideReason} className="ml-1 text-xs text-amber-400">(overridden)</span>}
                    {l.included === false && <span className="ml-1 text-xs text-gray-500">(optional — excluded)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{l.quantity}</td>
                  <td className="px-4 py-3 text-gray-300">{l.unit}</td>
                  <td className="px-4 py-3 text-gray-300">{l.listPrice != null ? formatMoney(l.listPrice, quote.currency) : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{l.priceBookPrice != null ? formatMoney(l.priceBookPrice, quote.currency) : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(l.unitPrice, quote.currency)}</td>
                  <td className="px-4 py-3 text-gray-300">{l.discountType ? (l.discountType === "Percentage" ? `${l.discountValue}%` : formatMoney(l.discountValue, quote.currency)) : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{l.taxCategory}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(computeLineTotal(l), quote.currency)}</td>
                  <td className="px-4 py-3 text-gray-300">{l.billingModel}{l.billingInterval ? ` (${l.billingInterval})` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 grid sm:grid-cols-2 gap-3 text-sm">
        <div className="space-y-1">
          <p className="text-gray-500 text-xs uppercase">One-time</p>
          <p className="font-semibold">{formatMoney(totals.oneTimeTotal, quote.currency)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-gray-500 text-xs uppercase">Recurring (monthly / annual)</p>
          <p className="font-semibold">{formatMoney(totals.monthlyRecurringTotal, quote.currency)} / {formatMoney(totals.annualRecurringTotal, quote.currency)}</p>
        </div>
      </div>
    </div>
  );
}

function ApprovalsTab({ quote, onApprove, onReject, onRequestChanges }) {
  const [comment, setComment] = useState("");
  const approval = quote.approval || {};
  const isPending = getEffectiveStatus(quote) === "Approval Pending";
  const warnings = computeQuoteWarnings(quote);
  return (
    <div className="space-y-4">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="Approval Requirement" value={approval.required ? "Required" : "Not Required"} />
          <Field label="Approval Status" value={approval.status || "Not Required"} />
          <Field label="Requested By" value={approval.requestedBy || "—"} />
          <Field label="Requested Date" value={approval.requestedAt ? formatDateTime(approval.requestedAt) : "—"} />
          <Field label="Assigned Reviewer" value={approval.reviewerName || "—"} />
          <Field label="Discount/Override Reason" value={approval.reason || "—"} />
        </dl>
      </div>
      {warnings.length > 0 && (
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200">
          <p className="font-medium mb-1 flex items-center gap-1.5"><AlertTriangle size={13} /> Frontend pricing warnings:</p>
          <ul className="list-disc list-inside">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </div>
      )}
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold">Review comments</h3>
        {(approval.comments || []).length === 0 ? <p className="text-sm text-gray-500">No review comments yet.</p> : (
          <ul className="space-y-2">
            {approval.comments.map((c, i) => (
              <li key={i} className="text-sm bg-gray-800/40 rounded-lg p-2"><span className="font-medium">{c.author}</span> <span className="text-gray-500 text-xs">({c.type}, {formatDateTime(c.at)})</span><p className="text-gray-300">{c.text}</p></li>
            ))}
          </ul>
        )}
      </div>
      {isPending && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">Prototype review actions</h3>
          <p className="text-xs text-gray-500">Reject and Request Changes require a comment. This is a frontend preview only — it does not represent a completed backend approval.</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Comment (required for Reject / Request Changes)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => onApprove(comment)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-sm"><ThumbsUp size={14} /> Approve</button>
            <button disabled={!comment.trim()} onClick={() => onReject(comment)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm"><ThumbsDown size={14} /> Reject</button>
            <button disabled={!comment.trim()} onClick={() => onRequestChanges(comment)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 disabled:opacity-50 text-sm"><MessageSquare size={14} /> Request Changes</button>
          </div>
        </div>
      )}
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

function VersionsTab({ family, currentId, onCompare }) {
  const [selected, setSelected] = useState([]);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : [s[1], id]));
  if (family.length <= 1) return <EmptyPanel icon={FileText} text="Only one version exists for this Quote." />;
  return (
    <div className="space-y-3">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
            <th className="px-4 py-3 w-8"></th><th className="px-4 py-3 font-medium">Version</th><th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Created By</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Total</th><th className="px-4 py-3 font-medium">Change Summary</th>
          </tr></thead>
          <tbody>
            {family.map((q) => (
              <tr key={q._id} className={`border-t border-gray-800 ${q._id === currentId ? "bg-blue-900/10" : ""}`}>
                <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(q._id)} onChange={() => toggle(q._id)} aria-label={`Select version ${q.version}`} /></td>
                <td className="px-4 py-3 font-medium"><Link to={`/sales/quotes/${q._id}`} className="text-blue-400 hover:underline">v{q.version}</Link>{q._id === currentId && <span className="ml-2 text-xs text-blue-300">(current view)</span>}</td>
                <td className="px-4 py-3 text-gray-300">{formatDate(q.createdAt)}</td>
                <td className="px-4 py-3 text-gray-300">{q.createdBy}</td>
                <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${QUOTE_STATUS_COLORS[getEffectiveStatus(q)]}`}>{getEffectiveStatus(q)}</span></td>
                <td className="px-4 py-3 text-gray-300">{formatMoney(computeQuoteTotals(q).grandTotal, q.currency)}</td>
                <td className="px-4 py-3 text-gray-300">{q.changeSummary || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button disabled={selected.length !== 2} onClick={() => onCompare(selected)} className="flex items-center gap-1.5 text-sm text-blue-400 hover:underline disabled:opacity-50 disabled:no-underline">
        <Scale size={14} /> Compare selected versions
      </button>
    </div>
  );
}

function FilesTab({ quote }) {
  const files = quote.files || [];
  if (files.length === 0) {
    return (<div className="space-y-3"><EmptyPanel icon={FileText} text="No files attached yet." /><div className="border-2 border-dashed border-gray-700 rounded-xl p-6 text-center text-gray-500 text-sm">Drag and drop a file here, or browse (upload preview only)</div></div>);
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

function ArchiveDetailDialog({ quote, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => { e.preventDefault(); if (!reason.trim()) return; await dispatch(archiveQuote({ id: quote._id, reason })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Archive Quote" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Archive &quot;{quote.quoteNumber}&quot;</h2>
        <p className="text-sm text-gray-400">Archived Quotes remain visible through filters and the related Deal&apos;s Quote history.</p>
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button><button type="submit" disabled={!reason.trim()} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">Archive</button></div>
      </form>
    </div>
  );
}
function CancelDetailDialog({ quote, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => { e.preventDefault(); await dispatch(cancelQuote({ id: quote._id, reason })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Cancel Quote" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Cancel &quot;{quote.quoteNumber}&quot;</h2>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (optional)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Back</button><button type="submit" className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Cancel Quote</button></div>
      </form>
    </div>
  );
}
function SendDetailDialog({ quote, onClose, onDone }) {
  const dispatch = useDispatch();
  const [form, setForm] = useState({ recipientEmail: "", cc: "", subject: `Your Quote ${quote.quoteNumber}`, message: "Please find your quote for review." });
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => { e.preventDefault(); if (!form.recipientEmail.trim()) return; await dispatch(previewSend({ id: quote._id, ...form })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Preview Send" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-bold">Preview Send</h2>
        <p className="text-xs text-amber-300">No email will be sent during this frontend phase. Confirming may move this Quote to Preview Sent status.</p>
        <input required value={form.recipientEmail} onChange={(e) => setForm((f) => ({ ...f, recipientEmail: e.target.value }))} placeholder="Recipient email" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input value={form.cc} onChange={(e) => setForm((f) => ({ ...f, cc: e.target.value }))} placeholder="CC (preview)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Subject" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} rows={3} placeholder="Message" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button><button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Simulate Send</button></div>
      </form>
    </div>
  );
}
function ResponseDetailDialog({ quote, onClose, onDone }) {
  const dispatch = useDispatch();
  const [type, setType] = useState("Viewed");
  const [details, setDetails] = useState({ customerName: "", jobTitle: "", typedNamePreview: "", reason: "", accepted: false });
  const containerRef = useFocusTrap(true, onClose);
  const needsReason = type === "Rejected" || type === "Changes Requested";
  const canSubmit = !needsReason || details.reason.trim();
  const submit = async (e) => { e.preventDefault(); if (!canSubmit) return; await dispatch(simulateCustomerResponse({ id: quote._id, type, details })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Preview Customer Response" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-bold">Preview Customer Response</h2>
        <p className="text-xs text-gray-500">A controlled frontend simulation only — not a real customer action or legally binding signature.</p>
        <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">{CUSTOMER_RESPONSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        {type === "Accepted" && (
          <>
            <input value={details.customerName} onChange={(e) => setDetails((d) => ({ ...d, customerName: e.target.value }))} placeholder="Customer name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input value={details.jobTitle} onChange={(e) => setDetails((d) => ({ ...d, jobTitle: e.target.value }))} placeholder="Job title" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={details.accepted} onChange={(e) => setDetails((d) => ({ ...d, accepted: e.target.checked }))} /> I confirm acceptance of this Quote (preview only)</label>
            <input value={details.typedNamePreview} onChange={(e) => setDetails((d) => ({ ...d, typedNamePreview: e.target.value }))} placeholder="Typed name (preview — not a legal signature)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </>
        )}
        {needsReason && <textarea required value={details.reason} onChange={(e) => setDetails((d) => ({ ...d, reason: e.target.value }))} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button><button type="submit" disabled={!canSubmit} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Simulate Response</button></div>
      </form>
    </div>
  );
}
function HandoffPreviewDialog({ action, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={action} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{action} (Preview)</h2>
        <p className="text-sm text-gray-400">This is a preview of the &quot;{action}&quot; handoff action. Its route hasn&apos;t been implemented yet, so no Order, Contract, Project, Invoice, or Onboarding record has been created.</p>
        <div className="flex justify-end"><button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Close</button></div>
      </div>
    </div>
  );
}
