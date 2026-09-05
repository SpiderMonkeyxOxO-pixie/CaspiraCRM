import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X } from "lucide-react";
import { compareRoles } from "../../redux/admin/rolesSlice";
import { allRoles, ACTION_LABELS, isHighRiskGrant } from "../../Helpers/mockRbacData";
import useFocusTrap from "../../hooks/useFocusTrap";

export default function CompareRolesDialog({ initialRoleIds = [], onClose }) {
  const dispatch = useDispatch();
  const comparison = useSelector((s) => s.adminRoles.comparison);
  const roles = allRoles();
  const [selectedIds, setSelectedIds] = useState(
    initialRoleIds.length >= 2 ? initialRoleIds.slice(0, 3) : [roles[0]?.id, roles[1]?.id].filter(Boolean)
  );
  const dialogRef = useFocusTrap(true, onClose);

  useEffect(() => {
    if (selectedIds.length >= 2) dispatch(compareRoles(selectedIds));
  }, [dispatch, selectedIds]);

  const toggleRole = (id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((r) => r !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Compare Roles"
        className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-5xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Compare Roles</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-800 flex flex-wrap gap-2">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => toggleRole(r.id)}
              aria-pressed={selectedIds.includes(r.id)}
              disabled={!selectedIds.includes(r.id) && selectedIds.length >= 3}
              className={`px-3 py-1.5 rounded-full text-xs border transition ${
                selectedIds.includes(r.id)
                  ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                  : "bg-gray-800/60 text-gray-400 border-gray-700 disabled:opacity-40"
              }`}
            >
              {r.name}
            </button>
          ))}
          <span className="text-[11px] text-gray-500 self-center ml-2">Select two or three roles</span>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {!comparison || comparison.roles.length < 2 ? (
            <p className="text-sm text-gray-400">Select at least two roles to compare.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-[#12141c]">
                  <tr>
                    <th scope="col" className="text-left text-gray-400 font-medium px-3 py-2 sticky left-0 bg-[#12141c]">Module</th>
                    {comparison.roles.map((r) => (
                      <th scope="col" key={r.id} className="text-left text-gray-300 font-medium px-3 py-2 min-w-[180px]">{r.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((row) => (
                    <tr key={row.moduleId} className="border-t border-gray-800">
                      <th scope="row" className="text-left text-gray-300 px-3 py-2 sticky left-0 bg-[#12141c] font-normal">{row.moduleLabel}</th>
                      {row.perRole.map((cell) => (
                        <td key={cell.roleId} className="px-3 py-2 align-top">
                          {cell.actions.length === 0 ? (
                            <span className="text-gray-600">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {cell.actions.map((a) => (
                                <span
                                  key={a}
                                  className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                    isHighRiskGrant(row.moduleId, a)
                                      ? "bg-red-500/15 text-red-300 border-red-500/30"
                                      : "bg-gray-800 text-gray-300 border-gray-700"
                                  }`}
                                >
                                  {ACTION_LABELS[a] || a}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
