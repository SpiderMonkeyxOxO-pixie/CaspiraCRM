import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Info, Eye, EyeOff, ShieldCheck, ShieldOff, CheckCircle2, XCircle } from "lucide-react";
import { runAccessPreview } from "../../redux/admin/rolesSlice";
import { allRoles, SCOPES } from "../../Helpers/mockRbacData";
import { findModule } from "../../Helpers/mockRbacData";

const CRM_DEPARTMENTS = ["Sales", "Support", "Marketing", "Finance", "HR"];
const CRM_TEAMS = ["Team Alpha", "Team Bravo", "Team Charlie"];

export default function AccessPreviewPanel({ initialRoleId }) {
  const dispatch = useDispatch();
  const accessPreview = useSelector((s) => s.adminRoles.accessPreview);
  const roles = allRoles();

  const [form, setForm] = useState({
    roleId: initialRoleId || roles[0]?.id || "",
    scope: "",
    department: "",
    team: "",
    exampleUserId: "",
    exampleRecordOwnerId: "",
    exampleRecordDepartment: "",
    exampleRecordTeam: "",
    exampleCustomerAccount: "",
    isOwnRecordForApproval: false,
  });

  useEffect(() => {
    if (initialRoleId) setForm((f) => ({ ...f, roleId: initialRoleId }));
  }, [initialRoleId]);

  const update = (field) => (e) => {
    const value = e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const runPreview = () => {
    dispatch(runAccessPreview(form));
  };

  useEffect(() => {
    if (form.roleId) runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.roleId, form.scope, form.department, form.team, form.exampleRecordDepartment, form.exampleRecordTeam, form.isOwnRecordForApproval]);

  const selectedRole = roles.find((r) => r.id === form.roleId);

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-4 h-fit">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Eye size={16} /> Access Preview inputs
        </h3>

        <div>
          <label htmlFor="preview-role" className="block text-xs text-gray-400 mb-1">Role</label>
          <select id="preview-role" aria-label="Preview role" value={form.roleId} onChange={update("roleId")}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="preview-scope" className="block text-xs text-gray-400 mb-1">Scope</label>
          <select id="preview-scope" aria-label="Preview scope" value={form.scope} onChange={update("scope")}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">{selectedRole ? `Default (${selectedRole.defaultScope})` : "Default"}</option>
            {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="preview-department" className="block text-xs text-gray-400 mb-1">Department</label>
          <select id="preview-department" aria-label="Preview department" value={form.department} onChange={update("department")}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Not set</option>
            {CRM_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="preview-team" className="block text-xs text-gray-400 mb-1">Team</label>
          <select id="preview-team" aria-label="Preview team" value={form.team} onChange={update("team")}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Not set</option>
            {CRM_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="preview-example-user" className="block text-xs text-gray-400 mb-1">Example user</label>
          <input id="preview-example-user" aria-label="Example user" value={form.exampleUserId} onChange={update("exampleUserId")}
            placeholder="e.g. Priya Nair" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
        </div>

        <div>
          <label htmlFor="preview-record-department" className="block text-xs text-gray-400 mb-1">Example record department</label>
          <select id="preview-record-department" aria-label="Example record department" value={form.exampleRecordDepartment} onChange={update("exampleRecordDepartment")}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Not set</option>
            {CRM_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="preview-record-team" className="block text-xs text-gray-400 mb-1">Example record team</label>
          <select id="preview-record-team" aria-label="Example record team" value={form.exampleRecordTeam} onChange={update("exampleRecordTeam")}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Not set</option>
            {CRM_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="preview-customer-account" className="block text-xs text-gray-400 mb-1">Example customer account</label>
          <input id="preview-customer-account" aria-label="Example customer account" value={form.exampleCustomerAccount} onChange={update("exampleCustomerAccount")}
            placeholder="e.g. Bednar and Sons" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={form.isOwnRecordForApproval} onChange={update("isOwnRecordForApproval")} />
          Simulate: this user submitted the record they're trying to approve
        </label>

        <button onClick={runPreview} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2">
          Run Access Preview
        </button>
      </div>

      <div className="space-y-4">
        {!accessPreview ? (
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-400 text-sm">
            Choose a role and run the preview to see what it can access.
          </div>
        ) : (
          <>
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-400" /> Visible navigation
              </h3>
              <div className="flex flex-wrap gap-2" role="list" aria-label="Visible navigation sections">
                {accessPreview.visibleNav.length === 0 && <p className="text-xs text-gray-500">No navigation sections are visible for this role.</p>}
                {accessPreview.visibleNav.map((n) => (
                  <span key={n.label} role="listitem" className="px-3 py-1 rounded-full text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {n.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" /> Accessible modules ({accessPreview.accessibleModules.length})
                </h3>
                <ul className="text-xs text-gray-300 space-y-1 max-h-56 overflow-y-auto" aria-label="Accessible modules">
                  {accessPreview.accessibleModules.map((id) => (
                    <li key={id} className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> {findModule(id)?.label || id}</li>
                  ))}
                </ul>
              </div>
              <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <XCircle size={16} className="text-red-400" /> Hidden actions / modules ({accessPreview.hiddenModules.length})
                </h3>
                <ul className="text-xs text-gray-400 space-y-1 max-h-56 overflow-y-auto" aria-label="Hidden modules">
                  {accessPreview.hiddenModules.map((id) => (
                    <li key={id} className="flex items-center gap-2"><XCircle size={12} className="text-red-500 shrink-0" /> {findModule(id)?.label || id}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <EyeOff size={16} className="text-amber-400" /> Masked / restricted fields
                </h3>
                {accessPreview.maskedFields.length === 0 ? (
                  <p className="text-xs text-gray-500">No sensitive fields are restricted for this role.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {accessPreview.maskedFields.map((id) => (
                      <span key={id} className="px-2 py-1 rounded-md text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30">{id.replace(/_/g, " ")}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <ShieldOff size={16} className="text-blue-400" /> Approval capability
                </h3>
                {accessPreview.approvalCapability.length === 0 ? (
                  <p className="text-xs text-gray-500">This role cannot approve any workflow.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {accessPreview.approvalCapability.map((id) => (
                      <span key={id} className="px-2 py-1 rounded-md text-xs bg-blue-500/15 text-blue-300 border border-blue-500/30 capitalize">{id.replace(/_/g, " ")}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {accessPreview.explanations.length > 0 && (
              <div className="bg-amber-900/10 border border-amber-800/30 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-amber-200 mb-2 flex items-center gap-2">
                  <Info size={16} /> Explanation for denied or restricted access
                </h3>
                <ul className="text-xs text-amber-200/90 space-y-1 list-disc list-inside">
                  {accessPreview.explanations.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-gray-500">
              This is a frontend permission preview. It does not enforce access on any server and does not replace future backend authorization.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
