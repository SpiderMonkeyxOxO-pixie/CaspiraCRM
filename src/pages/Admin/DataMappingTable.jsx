import { ShieldAlert } from "lucide-react";
import { CONFLICT_RULES } from "../../Helpers/mockIntegrationsData";

// Reusable data-mapping table shared across the Integration Center — rows
// always reference the CRM's own shared entities (Leads, Contacts,
// Companies, Activities, Deals, Products and Services, Quotes, Orders,
// Contracts), never a fake independent copy of a CRM record. There is
// deliberately no "add a raw field" picker here, so a hidden/sensitive CRM
// field can never be mapped to an external provider through this UI —
// mappings are always pre-defined per provider capability.
export default function DataMappingTable({ mappings, canManage, onChangeConflictRule }) {
  if (!mappings || mappings.length === 0) {
    return <p className="text-sm text-gray-400">No field mappings are configured for this preview connection yet.</p>;
  }
  return (
    <div className="overflow-x-auto border border-gray-800 rounded-xl">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
          <tr>
            <th scope="col" className="text-left px-4 py-3">CRM Entity</th>
            <th scope="col" className="text-left px-4 py-3">CRM Field</th>
            <th scope="col" className="text-left px-4 py-3">Provider Entity</th>
            <th scope="col" className="text-left px-4 py-3">Provider Field</th>
            <th scope="col" className="text-left px-4 py-3">Direction</th>
            <th scope="col" className="text-left px-4 py-3">Required</th>
            <th scope="col" className="text-left px-4 py-3">Transformation</th>
            <th scope="col" className="text-left px-4 py-3">Conflict Rule</th>
            <th scope="col" className="text-left px-4 py-3">Validation</th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((m) => (
            <tr key={m.id} className="border-t border-gray-800">
              <td className="px-4 py-3 text-white">{m.crmEntity}</td>
              <td className="px-4 py-3 text-gray-300">
                {m.crmField}
                {m.sensitive && (
                  <span className="text-[11px] text-amber-300 flex items-center gap-1 mt-0.5">
                    <ShieldAlert size={11} /> Sensitive field — requires permission
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-300">{m.providerEntity}</td>
              <td className="px-4 py-3 text-gray-300 font-mono text-xs">{m.providerField}</td>
              <td className="px-4 py-3 text-gray-300">{m.direction}</td>
              <td className="px-4 py-3 text-gray-300">{m.required ? "Required" : "Optional"}</td>
              <td className="px-4 py-3 text-gray-400">{m.transformation}</td>
              <td className="px-4 py-3">
                {canManage ? (
                  <select
                    aria-label={`Conflict rule for ${m.crmEntity} ${m.crmField}`}
                    value={m.conflictRule}
                    onChange={(e) => onChangeConflictRule?.(m.id, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    {CONFLICT_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <span className="text-gray-300 text-xs">{m.conflictRule}</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                  m.validationStatus === "Valid" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                }`}>
                  {m.validationStatus}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
