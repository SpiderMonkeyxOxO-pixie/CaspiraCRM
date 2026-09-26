import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { Inbox, AlertTriangle, Clock, UserX, ChevronRight, Flame } from "lucide-react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie,
} from "recharts";
import { fetchTickets } from "../../redux/support/ticketsSlice";
import { getSlaStatus, SLA_LABELS, SLA_COLORS } from "./slaUtils";
import { useChartColors } from "../../Context/ThemeContext";

const STATUS_COLORS = {
  New: "#60a5fa",
  Open: "#38bdf8",
  "In Progress": "#a78bfa",
  "Waiting for Customer": "#fbbf24",
  Resolved: "#34d399",
  Closed: "#6b7280",
};

const PRIORITY_HEX = { Low: "#9ca3af", Medium: "#60a5fa", High: "#fbbf24", Urgent: "#f87171" };
const PRIORITY_BADGE = {
  Low: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Medium: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  High: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Urgent: "bg-red-500/15 text-red-300 border-red-500/30",
};
const PRIORITY_RANK = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
const SLA_RANK = { breached: 3, "at-risk": 2, "on-track": 1, met: 0 };

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

export default function SupportDashboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const chartColors = useChartColors();
  const tickets = useSelector((s) => s.tickets.items);

  useEffect(() => {
    dispatch(fetchTickets());
  }, [dispatch]);

  const isResolvedStatus = (status) => ["Resolved", "Closed"].includes(status);
  const openTickets = tickets.filter((t) => !isResolvedStatus(t.status));
  const breachedResponse = openTickets.filter((t) => getSlaStatus(t.slaResponseDeadline, !!t.firstRespondedAt) === "breached");
  const breachedResolution = openTickets.filter((t) => getSlaStatus(t.slaResolutionDeadline, isResolvedStatus(t.status)) === "breached");
  const unassigned = openTickets.filter((t) => !t.assignedAgent);

  const statusData = useMemo(() => (
    ["New", "Open", "In Progress", "Waiting for Customer", "Resolved", "Closed"].map((status) => ({
      status, count: tickets.filter((t) => t.status === status).length,
    }))
  ), [tickets]);

  const priorityData = useMemo(() => (
    ["Urgent", "High", "Medium", "Low"]
      .map((priority) => ({ priority, count: openTickets.filter((t) => t.priority === priority).length }))
      .filter((d) => d.count > 0)
  ), [openTickets]);

  const prioritized = useMemo(() => {
    return openTickets
      .map((t) => {
        const responseSla = getSlaStatus(t.slaResponseDeadline, !!t.firstRespondedAt);
        const resolutionSla = getSlaStatus(t.slaResolutionDeadline, isResolvedStatus(t.status));
        const worstSla = SLA_RANK[responseSla] >= SLA_RANK[resolutionSla] ? responseSla : resolutionSla;
        const score = (PRIORITY_RANK[t.priority] || 0) * 10 + SLA_RANK[worstSla];
        return { ...t, worstSla, score };
      })
      .sort((a, b) => b.score - a.score || new Date(a.slaResponseDeadline) - new Date(b.slaResponseDeadline))
      .slice(0, 8);
  }, [openTickets]);

  return (
    <div className="p-8 text-white min-h-[calc(100vh-49px)]">
      <h1 className="text-2xl font-bold mb-1">Support Dashboard</h1>
      <p className="text-sm text-gray-400 mb-8">Tickets and SLA health</p>

      <div data-tour="support-kpis" className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Open Tickets" value={openTickets.length} to="/support/tickets" icon={Inbox} accent="bg-blue-500/15 text-blue-300" />
        <StatCard label="Response SLA Breached" value={breachedResponse.length} to="/support/tickets" icon={AlertTriangle} accent="bg-red-500/15 text-red-300" />
        <StatCard label="Resolution SLA Breached" value={breachedResolution.length} to="/support/tickets" icon={Clock} accent="bg-red-500/15 text-red-300" />
        <StatCard label="Unassigned" value={unassigned.length} to="/support/tickets" icon={UserX} accent="bg-amber-500/15 text-amber-300" />
      </div>

      <div data-tour="support-charts" className="grid lg:grid-cols-5 gap-6 mb-8">
        <div className="lg:col-span-3 bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Tickets by Status</h2>
          <div style={{ width: "100%", height: 300 }} role="img" aria-label="Bar chart of ticket counts per status">
            <ResponsiveContainer minWidth={0}>
              <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 24 }}
                onClick={(e) => { if (e?.activeLabel) navigate(`/support/tickets?status=${encodeURIComponent(e.activeLabel)}`); }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: chartColors.tick, fontSize: 11 }} />
                <YAxis type="category" dataKey="status" width={140} tick={{ fill: chartColors.tick, fontSize: 12 }} />
                <Tooltip cursor={{ fill: chartColors.cursorFill }} contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" barSize={22}>
                  {statusData.map((d) => <Cell key={d.status} fill={STATUS_COLORS[d.status]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-2 bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Open Tickets by Priority</h2>
          <div className="relative" style={{ width: "100%", height: 260 }} role="img" aria-label="Donut chart of open ticket counts per priority">
            {priorityData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">No open tickets.</div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold">{openTickets.length}</span>
                <span className="text-xs text-gray-500">open</span>
              </div>
            )}
            <ResponsiveContainer minWidth={0}>
              <PieChart>
                <Pie
                  data={priorityData.length > 0 ? priorityData : [{ priority: "None", count: 1 }]}
                  dataKey="count" nameKey="priority" cx="50%" cy="50%" innerRadius={65} outerRadius={100} paddingAngle={2} startAngle={90} endAngle={-270}
                  cursor={priorityData.length > 0 ? "pointer" : "default"}
                  onClick={(d) => { if (priorityData.length > 0) navigate(`/support/tickets?priority=${encodeURIComponent(d.priority)}`); }}
                >
                  {(priorityData.length > 0 ? priorityData : [{ priority: "None" }]).map((d) => (
                    <Cell key={d.priority} fill={priorityData.length > 0 ? PRIORITY_HEX[d.priority] : "#1f2937"} stroke="none" />
                  ))}
                </Pie>
                {priorityData.length > 0 && <Tooltip contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />}
              </PieChart>
            </ResponsiveContainer>
          </div>
          {priorityData.length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
              {priorityData.map((d) => (
                <button key={d.priority} onClick={() => navigate(`/support/tickets?priority=${encodeURIComponent(d.priority)}`)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PRIORITY_HEX[d.priority] }} />
                  {d.priority} ({d.count})
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div data-tour="support-next" className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <Flame className="h-4 w-4 text-amber-400" />
          <h2 className="font-semibold">Suggested Tickets to Prioritize</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">Ranked by priority and SLA risk — jump straight into what needs attention next.</p>

        {prioritized.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">You're all caught up — no open tickets.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {prioritized.map((t, i) => (
              <li key={t._id}>
                <Link to={`/support/tickets/${t._id}`} className="flex items-center gap-4 py-3.5 px-2 -mx-2 rounded-lg hover:bg-gray-800/40 transition-colors group">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs text-gray-400 font-medium">{i + 1}</span>
                  <span className={`shrink-0 px-2 py-1 rounded-full text-xs border ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{t.ticketNumber} · {t.subject}</p>
                    <p className="text-xs text-gray-500 truncate">{t.companyName} · {t.assignedAgent || "Unassigned"}</p>
                  </div>
                  {t.worstSla !== "on-track" && (
                    <span className={`shrink-0 px-2 py-1 rounded-full text-xs border ${SLA_COLORS[t.worstSla]}`}>{SLA_LABELS[t.worstSla]}</span>
                  )}
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
