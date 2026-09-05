import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, Clock, MessageSquare } from "lucide-react";
import { updateTask, addTaskComment, logTime, TASK_STATUSES, TASK_PRIORITIES } from "../../redux/projects/tasksSlice";

const PRIORITY_COLORS = {
  Low: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Medium: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  High: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Urgent: "bg-red-500/15 text-red-300 border-red-500/30",
};

export default function TaskDetailModal({ task, onClose }) {
  const dispatch = useDispatch();
  const currentUser = useSelector((s) => s.auth.data);
  const [comment, setComment] = useState("");
  const [hours, setHours] = useState("");
  const [showLogTime, setShowLogTime] = useState(false);

  if (!task) return null;

  const author = currentUser?.name || currentUser?.username || "You";
  const isOverdue = new Date(task.dueDate) < new Date() && task.status !== "Done";

  const submitComment = (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    dispatch(addTaskComment({ id: task._id, message: comment, author }));
    setComment("");
  };

  const submitLogTime = (e) => {
    e.preventDefault();
    if (!hours || Number(hours) <= 0) return;
    dispatch(logTime({ id: task._id, hours: Number(hours), author }));
    setHours("");
    setShowLogTime(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-start p-6 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-bold">{task.title}</h2>
            <p className="text-sm text-gray-400 mt-1">{task.description}</p>
          </div>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        <div className="p-6 grid sm:grid-cols-2 gap-4 border-b border-gray-800">
          <div>
            <label className="block text-xs text-gray-400 uppercase mb-1">Status</label>
            <select value={task.status} onChange={(e) => dispatch(updateTask({ id: task._id, changes: { status: e.target.value } }))}
              className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase mb-1">Priority</label>
            <select value={task.priority} onChange={(e) => dispatch(updateTask({ id: task._id, changes: { priority: e.target.value } }))}
              className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Assignee:</span> {task.assignee || "Unassigned"}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Due:</span>
            <span className={isOverdue ? "text-red-400 font-medium" : ""}>
              {new Date(task.dueDate).toLocaleDateString()} {isOverdue && "(Overdue)"}
            </span>
          </div>
        </div>

        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Clock size={16} /> Time Tracking</h3>
            <button onClick={() => setShowLogTime(!showLogTime)} className="text-xs text-blue-400 hover:underline">Log time</button>
          </div>
          <p className="text-sm text-gray-400">{task.loggedHours || 0}h logged of {task.estimateHours}h estimated</p>
          <div className="w-full bg-gray-800 rounded-full h-1.5 mt-2">
            <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, ((task.loggedHours || 0) / (task.estimateHours || 1)) * 100)}%` }} />
          </div>
          {showLogTime && (
            <form onSubmit={submitLogTime} className="flex gap-2 mt-3">
              <input type="number" step="0.5" min="0" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Hours"
                className="w-24 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              <button type="submit" className="bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm">Add</button>
            </form>
          )}
        </div>

        <div className="p-6">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><MessageSquare size={16} /> Comments ({task.comments?.length || 0})</h3>
          <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
            {task.comments?.length === 0 ? (
              <p className="text-sm text-gray-500">No comments yet.</p>
            ) : (
              task.comments.map((c, i) => (
                <div key={i} className="bg-gray-800/50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{c.author}</span>
                    <span>{new Date(c.at).toLocaleString()}</span>
                  </div>
                  <p>{c.message}</p>
                </div>
              ))
            )}
          </div>
          <form onSubmit={submitComment} className="flex gap-2">
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment... (@mention teammates)"
              className="flex-1 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <button type="submit" className="bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export { PRIORITY_COLORS };
