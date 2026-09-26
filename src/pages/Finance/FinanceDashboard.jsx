import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { Wallet, AlertTriangle, TrendingUp, Receipt, ChevronRight, FlameKindling } from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fetchInvoices, INVOICE_STATUSES } from "../../redux/finance/invoicesSlice";
import { fetchExpenses } from "../../redux/finance/expensesSlice";
import { useChartColors } from "../../Context/ThemeContext";

const STATUS_COLORS = {
  Draft: "#6b7280", Approved: "#60a5fa", Sent: "#38bdf8", "Partially Paid": "#fbbf24",
  Paid: "#34d399", Overdue: "#f87171", Void: "#4b5563",
};

const AGING_BUCKETS = [
  { key: "current", label: "Current", max: 0, color: "#34d399" },
  { key: "1-30", label: "1–30 days", max: 30, color: "#fbbf24" },
  { key: "31-60", label: "31–60 days", max: 60, color: "#f59e0b" },
  { key: "61-90", label: "61–90 days", max: 90, color: "#fb923c" },
  { key: "90+", label: "90+ days", max: Infinity, color: "#ef4444" },
];

function bucketFor(daysPastDue) {
  if (daysPastDue <= 0) return AGING_BUCKETS[0];
  return AGING_BUCKETS.find((b) => daysPastDue <= b.max) || AGING_BUCKETS[AGING_BUCKETS.length - 1];
}

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

export default function FinanceDashboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const chartColors = useChartColors();
  const invoices = useSelector((s) => s.invoices.items);
  const expenses = useSelector((s) => s.expenses.items);

  useEffect(() => {
    dispatch(fetchInvoices());
    dispatch(fetchExpenses());
  }, [dispatch]);

  const outstanding = useMemo(() => invoices.filter((i) => !["Paid", "Void", "Draft"].includes(i.status)), [invoices]);
  const outstandingAmount = outstanding.reduce((sum, i) => sum + (i.amountDue || 0), 0);
  const overdue = useMemo(() => invoices.filter((i) => i.status === "Overdue"), [invoices]);
  const overdueAmount = overdue.reduce((sum, i) => sum + (i.amountDue || 0), 0);
  const revenueThisMonth = invoices.filter((i) => i.status === "Paid").reduce((sum, i) => sum + (i.total || 0), 0);
  const pendingExpenses = expenses.filter((e) => e.status === "Pending");

  const statusData = useMemo(() => (
    INVOICE_STATUSES.map((status) => ({ status, count: invoices.filter((i) => i.status === status).length }))
      .filter((d) => d.count > 0)
  ), [invoices]);

  const agingData = useMemo(() => {
    const totals = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));
    outstanding.forEach((i) => {
      const daysPastDue = Math.floor((Date.now() - new Date(i.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      totals[bucketFor(daysPastDue).key] += i.amountDue || 0;
    });
    return AGING_BUCKETS.map((b) => ({ ...b, amount: totals[b.key] }));
  }, [outstanding]);

  const needsAttention = useMemo(() => (
    [...overdue].sort((a, b) => (b.amountDue || 0) - (a.amountDue || 0)).slice(0, 8)
  ), [overdue]);

  const daysOverdue = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="p-8 text-white min-h-[calc(100vh-49px)]">
      <h1 className="text-2xl font-bold mb-1">Finance Dashboard</h1>
      <p className="text-sm text-gray-400 mb-8">Invoices, payments and expenses</p>

      <div data-tour="finance-kpis" className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Outstanding" value={`$${outstandingAmount.toLocaleString()}`} to="/finance/invoices" icon={Wallet} accent="bg-blue-500/15 text-blue-300" />
        <StatCard label="Overdue" value={`$${overdueAmount.toLocaleString()}`} to="/finance/invoices" icon={AlertTriangle} accent="bg-red-500/15 text-red-300" />
        <StatCard label="Revenue (Paid Invoices)" value={`$${revenueThisMonth.toLocaleString()}`} to="/finance/invoices" icon={TrendingUp} accent="bg-emerald-500/15 text-emerald-300" />
        <StatCard label="Expenses Pending Review" value={pendingExpenses.length} to="/finance/expenses" icon={Receipt} accent="bg-amber-500/15 text-amber-300" />
      </div>

      <div data-tour="finance-charts" className="grid lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Invoices by Status</h2>
          {statusData.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">No invoices yet.</p>
          ) : (
            <div style={{ width: "100%", height: Math.max(180, statusData.length * 38) }} role="img" aria-label="Bar chart of invoice counts per status">
              <ResponsiveContainer minWidth={0}>
                <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 24 }}
                  onClick={() => navigate("/finance/invoices")}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: chartColors.tick, fontSize: 11 }} />
                  <YAxis type="category" dataKey="status" width={100} tick={{ fill: chartColors.tick, fontSize: 11 }} />
                  <Tooltip cursor={{ fill: chartColors.cursorFill }} contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" barSize={20}>
                    {statusData.map((d) => <Cell key={d.status} fill={STATUS_COLORS[d.status]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Receivables Aging</h2>
          {outstanding.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">Nothing outstanding.</p>
          ) : (
            <div style={{ width: "100%", height: 220 }} role="img" aria-label="Bar chart of outstanding invoice amount by age bucket">
              <ResponsiveContainer minWidth={0}>
                <BarChart data={agingData} margin={{ top: 8, right: 8 }} onClick={() => navigate("/finance/invoices")}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: chartColors.tick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chartColors.tick, fontSize: 11 }} tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                  <Tooltip cursor={{ fill: chartColors.cursorFill }} formatter={(v) => `$${Number(v).toLocaleString()}`} contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]} cursor="pointer" barSize={36}>
                    {agingData.map((d) => <Cell key={d.key} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <FlameKindling className="h-4 w-4 text-red-400" />
          <h2 className="font-semibold">Invoices Needing Attention</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">Overdue invoices, largest balance first.</p>

        {needsAttention.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No overdue invoices.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {needsAttention.map((i) => (
              <li key={i._id}>
                <Link to={`/finance/invoices/${i._id}`} className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-gray-800/40 transition-colors group">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{i.invoiceNumber} · {i.companyName}</p>
                    <p className="text-xs text-gray-500 truncate">{daysOverdue(i.dueDate)} days overdue</p>
                  </div>
                  <span className="shrink-0 px-2 py-1 rounded-full text-xs border bg-red-500/15 text-red-300 border-red-500/30">
                    ${i.amountDue?.toLocaleString()}
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-gray-300 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
