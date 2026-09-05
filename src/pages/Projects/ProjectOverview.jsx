import { useOutletContext } from "react-router-dom";
import { useSelector } from "react-redux";

export default function ProjectOverview() {
  const { project } = useOutletContext();
  const tasks = useSelector((s) => s.tasks.items.filter((t) => t.projectId === project._id));

  const done = tasks.filter((t) => t.status === "Done").length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const overdue = tasks.filter((t) => new Date(t.dueDate) < new Date() && t.status !== "Done");
  const totalLogged = tasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);
  const totalEstimate = tasks.reduce((sum, t) => sum + (t.estimateHours || 0), 0);

  return (
    <div className="p-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Progress</p>
          <p className="text-2xl font-bold">{progress}%</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Tasks</p>
          <p className="text-2xl font-bold">{done}/{tasks.length}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Overdue</p>
          <p className={`text-2xl font-bold ${overdue.length > 0 ? "text-red-400" : ""}`}>{overdue.length}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Time Logged</p>
          <p className="text-2xl font-bold">{totalLogged}h <span className="text-sm text-gray-500">/ {totalEstimate}h</span></p>
        </div>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
        <h2 className="font-semibold mb-2">Description</h2>
        <p className="text-sm text-gray-400">{project.description || "No description provided."}</p>
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-gray-400">Customer visibility:</span>
          <span className={project.customerVisible ? "text-emerald-400" : "text-gray-500"}>
            {project.customerVisible ? "Visible to customer" : "Internal only"}
          </span>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="mt-6 bg-red-900/20 border border-red-700/40 rounded-xl p-4">
          <h2 className="font-semibold mb-2 text-red-300">Overdue Tasks</h2>
          <ul className="space-y-1 text-sm text-red-200">
            {overdue.map((t) => <li key={t._id}>{t.title} — due {new Date(t.dueDate).toLocaleDateString()}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
