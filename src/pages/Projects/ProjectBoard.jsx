import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useOutletContext } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { updateTaskStatus, TASK_STATUSES } from "../../redux/projects/tasksSlice";
import TaskDetailModal, { PRIORITY_COLORS } from "./TaskDetailModal";

export default function ProjectBoard() {
  const { project } = useOutletContext();
  const dispatch = useDispatch();
  const tasks = useSelector((s) => s.tasks.items.filter((t) => t.projectId === project._id));
  const [selectedTask, setSelectedTask] = useState(null);

  const selected = selectedTask ? tasks.find((t) => t._id === selectedTask) : null;

  const columns = TASK_STATUSES.map((status) => ({ status, tasks: tasks.filter((t) => t.status === status) }));

  const moveNext = (task) => {
    const idx = TASK_STATUSES.indexOf(task.status);
    const next = TASK_STATUSES[idx + 1];
    if (next) dispatch(updateTaskStatus({ id: task._id, status: next }));
  };

  return (
    <div className="p-6">
      <div data-tour="project-board" className="flex gap-4 overflow-x-auto pb-4">
        {columns.map(({ status, tasks: colTasks }) => (
          <div key={status} className="flex-shrink-0 w-64 bg-gray-900/40 border border-gray-800 rounded-xl">
            <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
              <span className="font-medium text-sm">{status}</span>
              <span className="text-xs text-gray-500">{colTasks.length}</span>
            </div>
            <div className="p-3 space-y-3 min-h-[100px]">
              {colTasks.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-4">No tasks</p>
              ) : (
                colTasks.map((task) => {
                  const overdue = !!task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "Done";
                  return (
                    <div key={task._id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 text-sm">
                      <button onClick={() => setSelectedTask(task._id)} className="font-medium text-left hover:underline block mb-2">
                        {task.title}
                      </button>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
                        {status !== "Done" && (
                          <button onClick={() => moveNext(task)} title={`Move to ${TASK_STATUSES[TASK_STATUSES.indexOf(status) + 1]}`} className="text-gray-400 hover:text-blue-400">
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                      <p className={`text-xs ${overdue ? "text-red-400 font-medium" : "text-gray-500"}`}>
                        {task.assignee || "Unassigned"} · {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"} {overdue && "⚠"}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>

      {selected && <TaskDetailModal task={selected} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
