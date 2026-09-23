import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { fetchTasks, updateTaskStatus, TASK_STATUSES } from "../../redux/projects/tasksSlice";
import { fetchProjects } from "../../redux/projects/projectsSlice";
import TaskDetailModal, { PRIORITY_COLORS } from "./TaskDetailModal";

export default function AllTasks() {
  const dispatch = useDispatch();
  const tasks = useSelector((s) => s.tasks.items);
  const projects = useSelector((s) => s.projects.items);
  const [assigneeFilter, setAssigneeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedTask, setSelectedTask] = useState(null);

  useEffect(() => {
    dispatch(fetchTasks());
    dispatch(fetchProjects());
  }, [dispatch]);

  const projectName = (projectId) => projects.find((p) => p._id === projectId)?.name || "—";
  const assignees = useMemo(() => [...new Set(tasks.map((t) => t.assignee).filter(Boolean))], [tasks]);

  const filtered = tasks
    .filter((t) => assigneeFilter === "All" || t.assignee === assigneeFilter)
    .filter((t) => statusFilter === "All" || t.status === statusFilter);

  const selected = selectedTask ? tasks.find((t) => t._id === selectedTask) : null;
  const overdueCount = tasks.filter((t) => !!t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done").length;

  return (
    <div className="p-6 text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">All Tasks</h1>
        <p className="text-sm text-gray-400 mt-1">{filtered.length} of {tasks.length} tasks across all projects{overdueCount > 0 && <span className="text-red-400"> · {overdueCount} overdue</span>}</p>
      </div>

      <div className="flex gap-3 mb-4">
        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
          <option value="All">All Assignees</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
          <option value="All">All Statuses</option>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No tasks match these filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Task</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const overdue = !!t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done";
                return (
                  <tr key={t._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-medium cursor-pointer" onClick={() => setSelectedTask(t._id)}>{t.title}</td>
                    <td className="px-4 py-3 text-gray-300">
                      <Link to={`/projects/${t.projectId}/tasks`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{projectName(t.projectId)}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{t.assignee || "Unassigned"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs border ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                    </td>
                    <td className="px-4 py-3">
                      <select value={t.status} onChange={(e) => dispatch(updateTaskStatus({ id: t._id, status: e.target.value }))}
                        className="bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1 text-xs">
                        {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={`px-4 py-3 ${overdue ? "text-red-400 font-medium" : "text-gray-300"}`}>
                      {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "—"} {overdue && "(Overdue)"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && <TaskDetailModal task={selected} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
