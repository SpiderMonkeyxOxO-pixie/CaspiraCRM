import { computeLineTotal, computeOrderTotals } from "../../../Helpers/mockOrderData";
import { formatMoney, formatDate } from "./orderUtils";

// The customer-facing Order Confirmation preview. Internal notes and
// fulfillment operational detail (owners, setup/activation status) must
// never appear here — only what a customer would actually be shown.
export default function OrderDocumentPreview({ order, company, contact, sourceQuote, id: domId }) {
  const totals = computeOrderTotals(order);
  return (
    <div id={domId} className="bg-white text-gray-900 rounded-xl overflow-hidden text-sm">
      <div className="p-8 space-y-6">
        <div className="flex justify-between items-start border-b border-gray-200 pb-4">
          <div>
            <p className="text-xl font-bold tracking-tight">Caspira</p>
            <p className="text-gray-500 text-xs">123 Business Ave, Suite 100 (placeholder organization branding)</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">ORDER CONFIRMATION (Preview)</p>
            <p className="text-gray-500">{order.orderNumber}</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Customer</p>
            <p className="font-semibold">{company?.name || "—"}</p>
            <p className="text-gray-500">{contact?.name || "No contact selected"}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] uppercase text-gray-400 mb-1">Order details</p>
            <p className="text-gray-600">Order date {formatDate(order.orderDate)}</p>
            {sourceQuote && <p className="text-gray-600">From Quote {sourceQuote.quoteNumber} (v{order.sourceQuoteVersion})</p>}
            {order.requestedDate && <p className="text-gray-600">Requested {formatDate(order.requestedDate)}</p>}
          </div>
        </div>

        <div>
          <p className="font-semibold mb-2">{order.orderType}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-gray-300 text-left text-gray-500">
                <th className="py-2 pr-2 font-medium">Item</th><th className="py-2 pr-2 font-medium text-right">Qty</th>
                <th className="py-2 pr-2 font-medium text-right">Unit Price</th><th className="py-2 pr-2 font-medium text-right">Total</th>
              </tr></thead>
              <tbody>
                {(order.lineItems || []).map((l) => (
                  <tr key={l._id} className="border-b border-gray-100">
                    <td className="py-2 pr-2"><p className="font-medium">{l.name}</p>{l.description && <p className="text-gray-500 text-xs">{l.description}</p>}</td>
                    <td className="py-2 pr-2 text-right">{l.quantity} {l.unit}</td>
                    <td className="py-2 pr-2 text-right">{formatMoney(l.unitPrice, order.currency)}</td>
                    <td className="py-2 pr-2 text-right font-medium">{formatMoney(computeLineTotal(l), order.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-full sm:w-72 space-y-1">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatMoney(totals.subtotal, order.currency)}</span></div>
            {totals.tax > 0 && <div className="flex justify-between text-gray-600"><span>Tax (preview estimate)</span><span>{formatMoney(totals.tax, order.currency)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-300"><span>Grand Total</span><span>{formatMoney(totals.grandTotal, order.currency)}</span></div>
            {totals.oneTimeTotal > 0 && <div className="flex justify-between text-gray-500 text-xs"><span>One-time</span><span>{formatMoney(totals.oneTimeTotal, order.currency)}</span></div>}
            {totals.recurringTotal > 0 && <div className="flex justify-between text-gray-500 text-xs"><span>Recurring</span><span>{formatMoney(totals.recurringTotal, order.currency)}</span></div>}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 border-t border-gray-200 pt-4">
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Fulfillment</p>
            {order.orderType !== "Service Order" && order.serviceAddress?.line1 && (
              <p className="text-gray-600">{order.serviceAddress.line1}, {order.serviceAddress.city} {order.serviceAddress.postalCode}, {order.serviceAddress.country}</p>
            )}
            {order.deliveryInstructions && <p className="text-gray-600">{order.deliveryInstructions}</p>}
            {order.serviceStartInstructions && <p className="text-gray-600">{order.serviceStartInstructions}</p>}
          </div>
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Billing</p>
            <p className="text-gray-600">Payment terms: {order.paymentTerms}</p>
            <p className="text-gray-600">Billing: {order.billingSchedule}</p>
          </div>
        </div>

        {order.customerNote && (
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Note</p>
            <p className="text-gray-600 whitespace-pre-wrap">{order.customerNote}</p>
          </div>
        )}


      </div>
    </div>
  );
}
