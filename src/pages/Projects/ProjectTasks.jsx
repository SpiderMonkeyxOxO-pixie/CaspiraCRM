import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useOutletContext } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { createTask, TASK_PRIORITIES } from "../../redux/projects/tasksSlice";
import TaskDetailModal, { PRIORITY_COLORS } from "./TaskDetailModal";
import useCrmOwnerOptions from "../../hooks/useCrmOwnerOptions";
import { BACKEND_PROJECTS_MODE_ENABLED } from "../../Helpers/backendProjectsClient";

const emptyForm = { title: "", description: "", assignee: "", priority: "Medium", dueDate: "", estimateHours: 4 };

export default function ProjectTasks() {
  const { project } = useOutletContext();
  const dispatch = useDispatch();
  const tasks = useSelector((s) => s.tasks.items.filter((t) => t.projectId === project._id));
  const [selectedTask, setSelectedTask] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const members = useCrmOwnerOptions(BACKEND_PROJECTS_MODE_ENABLED);

  const selected = selectedTask ? tasks.find((t) => t._id === selectedTask) : null;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.title) return;
    await dispatch(createTask({ ...form, projectId: project._id, estimateHours: Number(form.estimateHours) }));
    setForm(emptyForm);
    setShowCreate(false);
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-400">{tasks.length} tasks</p>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm">
          <Plus size={16} /> New Task
        </button>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {tasks.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No tasks yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Task</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const overdue = !!t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done";
                return (
                  <tr key={t._id} onClick={() => setSelectedTask(t._id)} className="border-t border-gray-800 hover:bg-gray-800/40 cursor-pointer">
                    <td className="px-4 py-3 font-medium">{t.title}</td>
                    <td className="px-4 py-3 text-gray-300">{t.assignee || "Unassigned"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs border ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{t.status}</td>
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

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">New Task</h2>
              <button type="button" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Title *</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Assignee</label>
              {BACKEND_PROJECTS_MODE_ENABLED ? (
                <select value={form.assigneeId || ""} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              ) : (
                <input value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm mb-1 text-gray-300">Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-300">Due Date</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-300">Est. Hours</label>
                <input type="number" value={form.estimateHours} onChange={(e) => setForm({ ...form, estimateHours: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create Task</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
