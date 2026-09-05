import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import { Plus, X, FolderKanban, Building2, User, CalendarDays, AlignLeft, ChevronDown } from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fetchProjects, createProject, PROJECT_STATUSES } from "../../redux/projects/projectsSlice";
import { fetchTasks } from "../../redux/projects/tasksSlice";
import { fetchCompanies } from "../../redux/crm/companiesSlice";
import { useChartColors } from "../../Context/ThemeContext";

const STATUS_COLORS = {
  Planning: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Active: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "On Hold": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};
const STATUS_HEX = { Planning: "#9ca3af", Active: "#60a5fa", "On Hold": "#fbbf24", Completed: "#34d399" };

const emptyForm = { name: "", companyId: "", owner: "", dueDate: "", description: "" };

export default function ProjectsList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const chartColors = useChartColors();
  const { items: allProjects, loading } = useSelector((s) => s.projects);
  const tasks = useSelector((s) => s.tasks.items);
  const companies = useSelector((s) => s.companies.items);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState(null);

  useEffect(() => {
    dispatch(fetchProjects());
    dispatch(fetchTasks());
    dispatch(fetchCompanies());
  }, [dispatch]);

  const progressFor = (projectId) => {
    const projectTasks = tasks.filter((t) => t.projectId === projectId);
    if (projectTasks.length === 0) return 0;
    return Math.round((projectTasks.filter((t) => t.status === "Done").length / projectTasks.length) * 100);
  };

  const overdueCount = useMemo(() => (
    allProjects.filter((p) => p.status !== "Completed" && p.dueDate && new Date(p.dueDate) < new Date()).length
  ), [allProjects]);

  const avgCompletion = useMemo(() => {
    if (allProjects.length === 0) return 0;
    const total = allProjects.reduce((sum, p) => {
      const projectTasks = tasks.filter((t) => t.projectId === p._id);
      if (projectTasks.length === 0) return sum;
      return sum + (projectTasks.filter((t) => t.status === "Done").length / projectTasks.length) * 100;
    }, 0);
    return Math.round(total / allProjects.length);
  }, [allProjects, tasks]);

  const statusData = useMemo(() => (
    PROJECT_STATUSES.map((status) => ({ status, count: allProjects.filter((p) => p.status === status).length }))
      .filter((d) => d.count > 0)
  ), [allProjects]);

  const visibleProjects = statusFilter ? allProjects.filter((p) => p.status === statusFilter) : allProjects;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name) return;
    const company = companies.find((c) => c._id === form.companyId);
    const result = await dispatch(createProject({ ...form, companyName: company?.name })).unwrap().catch(() => null);
    setForm(emptyForm);
    setShowCreate(false);
    if (result?._id) navigate(`/projects/${result._id}/overview`);
  };

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-gray-400 mt-1">{allProjects.length} projects</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Project
        </button>
      </div>

      {!loading && allProjects.length > 0 && (
        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          <div className="grid grid-cols-3 gap-4 lg:col-span-2">
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 uppercase mb-1">Total</p>
              <p className="text-2xl font-bold">{allProjects.length}</p>
            </div>
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 uppercase mb-1">Overdue</p>
              <p className={`text-2xl font-bold ${overdueCount > 0 ? "text-red-400" : ""}`}>{overdueCount}</p>
            </div>
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 uppercase mb-1">Avg. Completion</p>
              <p className="text-2xl font-bold">{avgCompletion}%</p>
            </div>
          </div>

          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-medium text-gray-400 uppercase">By Status</h2>
              {statusFilter && (
                <button onClick={() => setStatusFilter(null)} className="text-xs text-blue-400 hover:underline">Clear filter</button>
              )}
            </div>
            <div style={{ width: "100%", height: 90 }} role="img" aria-label="Bar chart of project counts per status">
              <ResponsiveContainer minWidth={0}>
                <BarChart data={statusData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                  onClick={(e) => { if (e?.activeLabel) setStatusFilter(e.activeLabel === statusFilter ? null : e.activeLabel); }}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="status" width={70} tick={{ fill: chartColors.tick, fontSize: 10 }} />
                  <Tooltip cursor={{ fill: chartColors.cursorFill }} contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" barSize={14}>
                    {statusData.map((d) => <Cell key={d.status} fill={STATUS_HEX[d.status]} fillOpacity={statusFilter && statusFilter !== d.status ? 0.35 : 1} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-10 text-center text-gray-400">Loading projects...</div>
      ) : allProjects.length === 0 ? (
        <div className="p-10 text-center text-gray-400 bg-gray-900/40 border border-gray-800 rounded-xl">No projects yet.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleProjects.map((p) => {
            const progress = progressFor(p._id);
            return (
              <Link key={p._id} to={`/projects/${p._id}/overview`} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-5 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <h2 className="font-semibold">{p.name}</h2>
                  <span className={`px-2 py-1 rounded-full text-xs border shrink-0 ${STATUS_COLORS[p.status]}`}>{p.status}</span>
                </div>
                <p className="text-xs text-gray-500 mb-3">{p.companyName}</p>
                <div className="w-full bg-gray-800 rounded-full h-1.5 mb-1">
                  <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-gray-400">{progress}% complete · Due {p.dueDate ? new Date(p.dueDate).toLocaleDateString() : "—"}</p>
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div
          className="crm-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="crm-modal-shell w-full max-w-lg rounded-2xl bg-gradient-to-br from-blue-500/30 via-white/10 to-transparent p-px shadow-[0_25px_70px_-15px_rgba(0,0,0,0.75)]"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleCreate} className="rounded-[15px] bg-[#0b0f19] p-7">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/20">
                    <FolderKanban className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-white">New Project</h2>
                    <p className="text-xs text-gray-400">Kick off a new engagement</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-400">Project Name *</label>
                  <div className="relative">
                    <FolderKanban className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <input
                      required
                      placeholder="e.g. Acme Corp Onboarding"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-gray-600 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-400">Company</label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <select
                      value={form.companyId}
                      onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                      className="w-full appearance-none rounded-lg border border-white/10 bg-white/5 py-2.5 pl-10 pr-9 text-sm text-white outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">No company</option>
                      {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-400">Owner</label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                      <input
                        placeholder="Assign an owner"
                        value={form.owner}
                        onChange={(e) => setForm({ ...form, owner: e.target.value })}
                        className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-gray-600 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-400">Due Date</label>
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                      <input
                        type="date"
                        value={form.dueDate}
                        onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                        className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white outline-none transition-colors [color-scheme:dark] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-400">Description</label>
                  <div className="relative">
                    <AlignLeft className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-500" />
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={3}
                      placeholder="What's this project about?"
                      className="w-full resize-none rounded-lg border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-gray-600 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-white/10 pt-5">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-2 text-sm font-medium text-white transition-all hover:from-blue-500 hover:to-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                  <Plus className="h-4 w-4" /> Create Project
                </button>
              </div>
            </form>
          </div>
          <style>{`
            @keyframes crmModalOverlayIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes crmModalShellIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            .crm-modal-overlay { animation: crmModalOverlayIn 0.15s ease-out; }
            .crm-modal-shell { animation: crmModalShellIn 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
          `}</style>
        </div>
      )}
    </div>
  );
}
