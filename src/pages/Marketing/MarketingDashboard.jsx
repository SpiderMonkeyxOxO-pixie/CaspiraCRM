import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { Megaphone, Users, TrendingUp, Inbox, ChevronRight, CalendarClock } from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie } from "recharts";
import { fetchCampaigns, CAMPAIGN_STATUSES } from "../../redux/marketing/campaignsSlice";
import { fetchSegments } from "../../redux/marketing/segmentsSlice";
import { fetchForms } from "../../redux/marketing/formsSlice";
import { useChartColors } from "../../Context/ThemeContext";

const STATUS_HEX = { Draft: "#9ca3af", Active: "#34d399", Paused: "#fbbf24", Completed: "#60a5fa" };
const CHANNEL_COLORS = ["#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#38bdf8"];

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

export default function MarketingDashboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const chartColors = useChartColors();
  const campaigns = useSelector((s) => s.campaigns.items);
  const segments = useSelector((s) => s.segments.items);
  const forms = useSelector((s) => s.forms.items);

  useEffect(() => {
    dispatch(fetchCampaigns());
    dispatch(fetchSegments());
    dispatch(fetchForms());
  }, [dispatch]);

  const activeCampaigns = campaigns.filter((c) => c.status === "Active");
  const totalLeadsGenerated = campaigns.reduce((sum, c) => sum + (c.leadsGenerated || 0), 0);
  const totalConverted = campaigns.reduce((sum, c) => sum + (c.converted || 0), 0);
  const conversionRate = totalLeadsGenerated ? Math.round((totalConverted / totalLeadsGenerated) * 100) : 0;
  const totalSubmissions = forms.reduce((sum, f) => sum + (f.submissions || 0), 0);

  const channelData = useMemo(() => {
    const bySource = campaigns.reduce((acc, c) => {
      acc[c.channel] = (acc[c.channel] || 0) + (c.leadsGenerated || 0);
      return acc;
    }, {});
    return Object.entries(bySource).map(([channel, leads]) => ({ channel, leads })).filter((d) => d.leads > 0);
  }, [campaigns]);

  const statusData = useMemo(() => (
    CAMPAIGN_STATUSES.map((status) => ({ status, count: campaigns.filter((c) => c.status === status).length }))
      .filter((d) => d.count > 0)
  ), [campaigns]);

  const endingSoon = useMemo(() => {
    return campaigns
      .filter((c) => c.status === "Active" && c.endDate)
      .sort((a, b) => new Date(a.endDate) - new Date(b.endDate))
      .slice(0, 8);
  }, [campaigns]);

  const daysUntil = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div className="p-8 text-white min-h-[calc(100vh-49px)]">
      <h1 className="text-2xl font-bold mb-1">Marketing Dashboard</h1>
      <p className="text-sm text-gray-400 mb-8">Campaigns, segments and lead capture</p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Active Campaigns" value={activeCampaigns.length} to="/marketing/campaigns" icon={Megaphone} accent="bg-emerald-500/15 text-emerald-300" />
        <StatCard label="Leads Generated" value={totalLeadsGenerated} to="/crm/leads" icon={Users} accent="bg-blue-500/15 text-blue-300" />
        <StatCard label="Conversion Rate" value={`${conversionRate}%`} to="/marketing/campaigns" icon={TrendingUp} accent="bg-indigo-500/15 text-indigo-300" />
        <StatCard label="Form Submissions" value={totalSubmissions} to="/marketing/forms" icon={Inbox} accent="bg-amber-500/15 text-amber-300" />
      </div>

      <div className="grid lg:grid-cols-5 gap-6 mb-8">
        <div className="lg:col-span-3 bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Leads by Channel</h2>
          {channelData.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">No attributed leads yet.</p>
          ) : (
            <div style={{ width: "100%", height: 260 }} role="img" aria-label="Bar chart of leads generated per channel">
              <ResponsiveContainer minWidth={0}>
                <BarChart data={channelData} layout="vertical" margin={{ left: 8, right: 24 }}
                  onClick={(e) => { if (e?.activeLabel) navigate(`/crm/leads?source=${encodeURIComponent(e.activeLabel)}`); }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: chartColors.tick, fontSize: 11 }} />
                  <YAxis type="category" dataKey="channel" width={90} tick={{ fill: chartColors.tick, fontSize: 12 }} />
                  <Tooltip cursor={{ fill: chartColors.cursorFill }} contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
                  <Bar dataKey="leads" radius={[0, 4, 4, 0]} cursor="pointer" barSize={22}>
                    {channelData.map((d, i) => <Cell key={d.channel} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Campaigns by Status</h2>
          <div className="relative" style={{ width: "100%", height: 220 }} role="img" aria-label="Donut chart of campaign counts per status">
            {statusData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">No campaigns yet.</div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold">{campaigns.length}</span>
                <span className="text-xs text-gray-500">total</span>
              </div>
            )}
            <ResponsiveContainer minWidth={0}>
              <PieChart>
                <Pie
                  data={statusData.length > 0 ? statusData : [{ status: "None", count: 1 }]}
                  dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} startAngle={90} endAngle={-270}
                  cursor={statusData.length > 0 ? "pointer" : "default"}
                  onClick={() => { if (statusData.length > 0) navigate("/marketing/campaigns"); }}
                >
                  {(statusData.length > 0 ? statusData : [{ status: "None" }]).map((d) => (
                    <Cell key={d.status} fill={statusData.length > 0 ? STATUS_HEX[d.status] : "#1f2937"} stroke="none" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          {statusData.length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
              {statusData.map((d) => (
                <span key={d.status} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_HEX[d.status] }} />
                  {d.status} ({d.count})
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="h-4 w-4 text-amber-400" />
            <h2 className="font-semibold">Campaigns Ending Soon</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">Active campaigns, soonest end date first.</p>

          {endingSoon.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No active campaigns with an end date.</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {endingSoon.map((c) => {
                const days = daysUntil(c.endDate);
                return (
                  <li key={c._id}>
                    <Link to={`/marketing/campaigns/${c._id}`} className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-gray-800/40 transition-colors group">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-xs text-gray-500 truncate">{c.channel} · {c.leadsGenerated || 0} leads · {c.converted || 0} converted</p>
                      </div>
                      <span className={`shrink-0 px-2 py-1 rounded-full text-xs border ${days <= 3 ? "bg-red-500/15 text-red-300 border-red-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"}`}>
                        {days <= 0 ? "Ends today" : `${days}d left`}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-gray-300 shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Segments</h2>
          {segments.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              No segments yet. <Link to="/marketing/segments" className="text-blue-400 hover:underline">Create one</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {segments.slice(0, 8).map((s) => (
                <li key={s._id} className="flex justify-between items-center py-3">
                  <span className="text-sm text-gray-300">{s.name}</span>
                  <span className="text-xs text-gray-500">{s.memberCount} contacts</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
