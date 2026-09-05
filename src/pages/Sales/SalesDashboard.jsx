import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { FileText, Wallet, FileCheck2, Clock, ChevronRight, Flame } from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fetchQuotes } from "../../redux/sales/quotesSlice";
import { fetchOrders } from "../../redux/sales/ordersSlice";
import { fetchContracts } from "../../redux/sales/contractsSlice";
import { useChartColors } from "../../Context/ThemeContext";
import { fetchCompanies } from "../../redux/crm/companiesSlice";
import { computeQuoteTotals, getEffectiveStatus as getQuoteStatus, QUOTE_STATUSES } from "../../Helpers/mockQuoteData";
import { computeOrderTotals, getEffectiveStatus as getOrderStatus, ORDER_STATUSES } from "../../Helpers/mockOrderData";
import { getEffectiveStatus as getContractStatus } from "../../Helpers/mockContractData";
import { formatMoney } from "./Products/catalogUtils";

const QUOTE_STATUS_COLORS = {
  Draft: "#6b7280", "Internal Review": "#a78bfa", "Approval Pending": "#fbbf24", Approved: "#60a5fa",
  "Preview Sent": "#38bdf8", "Preview Viewed": "#818cf8", "Preview Accepted": "#34d399", "Preview Rejected": "#f87171",
  Expired: "#4b5563", Cancelled: "#ef4444", Superseded: "#9ca3af",
};
const ORDER_STATUS_COLORS = {
  Draft: "#6b7280", "Pending Review": "#fbbf24", Confirmed: "#60a5fa", Processing: "#a78bfa",
  "Partially Fulfilled": "#fbbf24", Fulfilled: "#34d399", "On Hold": "#fb923c", Cancelled: "#ef4444",
  Completed: "#10b981", Archived: "#4b5563",
};
const AWAITING_RESPONSE = ["Preview Sent", "Preview Viewed"];

function StatCard({ label, value, to, icon: Icon, accent }) {
  const content = (
    <div className="group bg-gray-900/40 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-colors h-full">
      <div className="flex items-start justify-between">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
      <p className="text-4xl font-bold">{value}</p>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

export default function SalesDashboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const chartColors = useChartColors();
  const quotes = useSelector((s) => s.quotes.items);
  const orders = useSelector((s) => s.orders.items);
  const contracts = useSelector((s) => s.contracts.items);
  const companies = useSelector((s) => s.companies.items);

  useEffect(() => {
    dispatch(fetchQuotes());
    dispatch(fetchOrders());
    dispatch(fetchContracts());
    dispatch(fetchCompanies());
  }, [dispatch]);

  const companyNameById = useMemo(() => new Map(companies.map((c) => [c._id, c.name])), [companies]);

  const orderValue = useMemo(() => orders.reduce((sum, o) => sum + computeOrderTotals(o).grandTotal, 0), [orders]);
  const signedContracts = useMemo(() => contracts.filter((c) => getContractStatus(c) === "Signed").length, [contracts]);
  const awaitingResponse = useMemo(
    () => quotes.filter((q) => AWAITING_RESPONSE.includes(getQuoteStatus(q))),
    [quotes]
  );

  const quoteStatusData = useMemo(() => (
    QUOTE_STATUSES.map((status) => ({ status, count: quotes.filter((q) => getQuoteStatus(q) === status).length }))
      .filter((d) => d.count > 0)
  ), [quotes]);

  const orderStatusData = useMemo(() => (
    ORDER_STATUSES.map((status) => ({ status, count: orders.filter((o) => getOrderStatus(o) === status).length }))
      .filter((d) => d.count > 0)
  ), [orders]);

  const followUpQueue = useMemo(() => {
    return quotes
      .filter((q) => AWAITING_RESPONSE.includes(getQuoteStatus(q)))
      .map((q) => ({ ...q, grandTotal: computeQuoteTotals(q).grandTotal }))
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt))
      .slice(0, 8);
  }, [quotes]);

  const recentOrders = useMemo(() => (
    [...orders].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6)
  ), [orders]);

  const daysAgo = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="p-8 text-white min-h-[calc(100vh-49px)]">
      <h1 className="text-2xl font-bold mb-1">Sales Dashboard</h1>
      <p className="text-sm text-gray-400 mb-8">Quotes, orders and contracts</p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Quotes" value={quotes.length} to="/sales/quotes" icon={FileText} accent="bg-blue-500/15 text-blue-300" />
        <StatCard label="Awaiting Response" value={awaitingResponse.length} to="/sales/quotes" icon={Clock} accent="bg-amber-500/15 text-amber-300" />
        <StatCard label="Order Value" value={formatMoney(orderValue, "USD")} to="/sales/orders" icon={Wallet} accent="bg-emerald-500/15 text-emerald-300" />
        <StatCard label="Signed Contracts" value={signedContracts} to="/sales/contracts" icon={FileCheck2} accent="bg-indigo-500/15 text-indigo-300" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Quotes by Status</h2>
          {quoteStatusData.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">No quotes yet.</p>
          ) : (
            <div style={{ width: "100%", height: Math.max(180, quoteStatusData.length * 38) }} role="img" aria-label="Bar chart of quote counts per status">
              <ResponsiveContainer minWidth={0}>
                <BarChart data={quoteStatusData} layout="vertical" margin={{ left: 8, right: 24 }}
                  onClick={(e) => { if (e?.activeLabel) navigate(`/sales/quotes?status=${encodeURIComponent(e.activeLabel)}`); }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: chartColors.tick, fontSize: 11 }} />
                  <YAxis type="category" dataKey="status" width={110} tick={{ fill: chartColors.tick, fontSize: 11 }} />
                  <Tooltip cursor={{ fill: chartColors.cursorFill }} contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" barSize={18}>
                    {quoteStatusData.map((d) => <Cell key={d.status} fill={QUOTE_STATUS_COLORS[d.status]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Orders by Status</h2>
          {orderStatusData.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">No orders yet.</p>
          ) : (
            <div style={{ width: "100%", height: Math.max(180, orderStatusData.length * 38) }} role="img" aria-label="Bar chart of order counts per status">
              <ResponsiveContainer minWidth={0}>
                <BarChart data={orderStatusData} layout="vertical" margin={{ left: 8, right: 24 }}
                  onClick={(e) => { if (e?.activeLabel) navigate(`/sales/orders?status=${encodeURIComponent(e.activeLabel)}`); }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: chartColors.tick, fontSize: 11 }} />
                  <YAxis type="category" dataKey="status" width={110} tick={{ fill: chartColors.tick, fontSize: 11 }} />
                  <Tooltip cursor={{ fill: chartColors.cursorFill }} contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" barSize={18}>
                    {orderStatusData.map((d) => <Cell key={d.status} fill={ORDER_STATUS_COLORS[d.status]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <Flame className="h-4 w-4 text-amber-400" />
            <h2 className="font-semibold">Quotes to Follow Up</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">Sent to the customer and waiting — oldest first.</p>

          {followUpQueue.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">Nothing waiting on a customer response.</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {followUpQueue.map((q) => (
                <li key={q._id}>
                  <Link to={`/sales/quotes/${q._id}`} className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-gray-800/40 transition-colors group">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{q.quoteNumber} · {q.title}</p>
                      <p className="text-xs text-gray-500 truncate">{companyNameById.get(q.companyId) || "—"} · {formatMoney(q.grandTotal, q.currency)}</p>
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-full text-xs border bg-amber-500/15 text-amber-300 border-amber-500/30">
                      {daysAgo(q.updatedAt)}d waiting
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-gray-300 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Recent Orders</h2>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              No orders yet. Orders are created from an accepted quote, or automatically when a deal is marked Won in{" "}
              <Link to="/crm/pipeline" className="text-blue-400 hover:underline">the CRM pipeline</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {recentOrders.map((o) => (
                <li key={o._id}>
                  <Link to={`/sales/orders/${o._id}`} className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-gray-800/40 transition-colors group">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{o.orderNumber} · {companyNameById.get(o.companyId) || "—"}</p>
                      <p className="text-xs text-gray-500 truncate">{formatMoney(computeOrderTotals(o).grandTotal, o.currency)} · {getOrderStatus(o)}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-gray-300 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
