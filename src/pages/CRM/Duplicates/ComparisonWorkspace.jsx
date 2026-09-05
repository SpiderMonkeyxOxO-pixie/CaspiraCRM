import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { X, AlertTriangle, CheckCircle2, Info, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";
import useFocusTrap from "../../../hooks/useFocusTrap";
import {
  compareRecords, getIdentityMeta, recommendMaster, detectSafetyConflicts, buildFinalValues,
} from "./duplicateFieldConfig";
import { compareTypeFor } from "./duplicateQuery";
import { confirmDuplicate, applyMergePreview, undoMergePreview } from "../../../redux/crm/duplicatesSlice";
import { activities } from "../../../Helpers/mockActivitiesData";
import { tickets } from "../../../Helpers/mockSupportData";
import { projects } from "../../../Helpers/mockProjectsData";
import { invoices } from "../../../Helpers/mockFinanceData";
import { quotes } from "../../../Helpers/mockSalesData";
import { RECORD_TYPE_LABELS, DETAIL_ROUTES, ACTIVITY_TYPE_FOR } from "./duplicateDisplayConfig";

const WORKSPACE_STEPS = ["compare", "configure", "review"];

function relatedRecordsFor(recordType, record) {
  const items = [];
  if (recordType === "companies") {
    items.push({ label: "Activities", count: activities.filter((a) => a.relatedRecordType === "Company" && a.relatedRecordId === record._id).length });
    items.push({ label: "Tickets", count: tickets.filter((t) => t.companyId === record._id).length });
    items.push({ label: "Projects", count: projects.filter((p) => p.companyId === record._id).length });
    items.push({ label: "Invoices", count: invoices.filter((i) => i.companyId === record._id).length });
    items.push({ label: "Quotes", count: quotes.filter((q) => q.companyId === record._id).length });
  } else if (recordType === "deals") {
    items.push({ label: "Quotes", count: quotes.filter((q) => q.dealId === record._id).length });
    items.push({ label: "Invoices", count: invoices.filter((i) => i.dealId === record._id).length });
  } else {
    const typeLabel = ACTIVITY_TYPE_FOR[recordType];
    items.push({ label: "Activities", count: activities.filter((a) => a.relatedRecordType === typeLabel && a.relatedRecordId === record._id).length });
  }
  items.push({ label: "Tasks", count: (record.tasks || []).filter((t) => !t.completed).length });
  items.push({ label: "Files", count: (record.files || []).length });
  return items;
}

export default function ComparisonWorkspace({ group, initialStep, lookups, onClose, navigate }) {
  const dispatch = useDispatch();
  const containerRef = useFocusTrap(true, onClose);
  const compareType = compareTypeFor(group);

  const allResolved = group.records.map((r) => ({ ...r, record: lookups[r.type]?.get(r.id) })).filter((x) => !!x.record);
  const [includedIds, setIncludedIds] = useState(() => new Set(allResolved.map((r) => r.id)));
  const included = allResolved.filter((r) => includedIds.has(r.id));
  const records = included.map((r) => r.record);

  const [step, setStep] = useState(initialStep === "configure" ? "configure" : "compare");
  // A mixed Lead+Contact group can only be mastered by the Contact side —
  // absorbing a real Contact's identity into a Lead doesn't make sense, and
  // it keeps the field-comparison config (the Contact field set for these
  // groups) valid for whatever ends up written to the master.
  const masterCandidates = group.mixedTypes ? records.filter((r) => allResolved.find((x) => x.id === r._id)?.type !== "leads") : records;
  const recommendation = useMemo(() => recommendMaster(compareType, masterCandidates), [compareType, masterCandidates]);
  const [masterOverride, setMasterOverride] = useState(null);
  const effectiveMasterId = masterOverride || recommendation?.recordId || masterCandidates[0]?._id;
  const master = records.find((r) => r._id === effectiveMasterId);
  const absorbed = records.filter((r) => r._id !== effectiveMasterId);

  const comparison = useMemo(
    () => compareRecords(compareType, records, { companiesById: lookups.companies, contactsById: lookups.contacts }),
    [compareType, records, lookups]
  );
  const [fieldSelections, setFieldSelections] = useState({});
  const changedFields = comparison.filter((f) => (fieldSelections[f.key] || effectiveMasterId) !== effectiveMasterId);

  const safetyConflicts = useMemo(() => detectSafetyConflicts(compareType, records), [compareType, records]);
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [lifecycleAcknowledged, setLifecycleAcknowledged] = useState(false);
  const [currencyAcknowledged, setCurrencyAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  // Resolved the moment the reviewer explicitly picks a value in the Owner
  // row below (even re-picking the master's own value counts — the point is
  // an explicit choice was made, never a silent default).
  const ownerFieldChosen = !safetyConflicts.owner || fieldSelections.ownerId !== undefined;
  const requiredUnresolved = [
    safetyConflicts.owner && !ownerFieldChosen && "Choose the final owner",
    safetyConflicts.consent && !consentAcknowledged && "Review the Do Not Contact conflict",
    safetyConflicts.lifecycle && !lifecycleAcknowledged && "Review the Customer/Prospect lifecycle conflict",
    safetyConflicts.currency && !currencyAcknowledged && "Acknowledge the currency conflict",
  ].filter(Boolean);
  const canApply = requiredUnresolved.length === 0 && reason.trim().length > 0 && absorbed.length > 0;

  const setFieldChoice = (fieldKey, recordId) => setFieldSelections((s) => ({ ...s, [fieldKey]: recordId }));

  const goToConfigure = () => setStep("configure");
  const goToReview = () => {
    dispatch(confirmDuplicate({ groupId: group.id }));
    setStep("review");
  };

  // For a mixed Lead+Contact group, the master is always the Contact side —
  // a real Contact record is the "target" identity; a Lead absorbing a
  // Contact's data the other way around doesn't make business sense, and
  // keeping the master's type fixed also keeps the field-comparison config
  // (which uses the Contact field set for these groups) valid for whatever
  // gets written to the master.
  const masterRecordType = allResolved.find((r) => r.id === effectiveMasterId)?.type || group.recordType;

  const handleApply = async () => {
    setApplying(true);
    const finalValues = buildFinalValues(compareType, records, fieldSelections, effectiveMasterId);
    const absorbedRecords = absorbed.map((r) => ({ type: allResolved.find((x) => x.id === r._id)?.type || group.recordType, id: r._id }));
    const action = await dispatch(applyMergePreview({
      groupId: group.id, masterType: masterRecordType, masterId: effectiveMasterId, absorbedRecords, finalValues, reason,
    }));
    setApplying(false);
    if (applyMergePreview.fulfilled.match(action)) {
      toast.success("Frontend merge preview applied for this session");
      setResult({ historyEntryId: action.payload.historyEntry.id, masterId: effectiveMasterId });
    }
  };

  const handleUndo = async () => {
    if (!result) return;
    await dispatch(undoMergePreview(result.historyEntryId));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={containerRef} role="dialog" aria-modal="true" aria-label={`Compare duplicate group — ${RECORD_TYPE_LABELS[group.recordType]}`}
        className="relative w-full lg:max-w-5xl h-full bg-gray-950 border-l border-gray-800 overflow-y-auto shadow-2xl flex flex-col"
      >
        <div className="sticky top-0 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold">Duplicate comparison</h2>
            <p className="text-xs text-gray-500">
              {group.records.length} record{group.records.length === 1 ? "" : "s"} · {group.confidenceLabel} confidence ({group.confidencePercent}%)
              {group.mixedTypes && " · Lead ↔ Contact relationship"}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close comparison workspace"><X size={20} /></button>
        </div>

        <div className="px-6 pt-4">
          <ol className="flex items-center gap-2 text-xs text-gray-400 mb-4" aria-label="Comparison workspace steps">
            {WORKSPACE_STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span aria-current={step === s ? "step" : undefined} className={`px-2.5 py-1 rounded-full border ${step === s ? "bg-blue-700 border-blue-600 text-white" : "border-gray-700"}`}>
                  {i + 1}. {s === "compare" ? "Compare" : s === "configure" ? "Choose master & values" : "Review & merge preview"}
                </span>
                {i < WORKSPACE_STEPS.length - 1 && <ArrowRight size={12} />}
              </li>
            ))}
          </ol>
        </div>

        {result ? (
          <div className="px-6 pb-6 flex-1">
            <div className="bg-emerald-900/10 border border-emerald-800/30 rounded-xl p-5">
              <p className="flex items-center gap-2 text-emerald-200 font-medium mb-2"><CheckCircle2 size={18} /> Frontend merge preview applied</p>
              <p className="text-sm text-gray-300 mb-1">This changed only the current frontend session. No production records were merged or deleted.</p>
              <p className="text-xs text-gray-500 mb-4">The absorbed record{absorbed.length === 1 ? "" : "s"} will no longer appear in ordinary {RECORD_TYPE_LABELS[group.recordType]} views. Undo restores everything for this session.</p>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => { navigate(`${DETAIL_ROUTES[masterRecordType]}/${effectiveMasterId}`); onClose(); }} className="text-sm text-blue-300 hover:underline">View master record</button>
                <button onClick={handleUndo} className="text-sm text-amber-300 hover:underline">Undo this merge</button>
                <button onClick={onClose} className="text-sm text-gray-300 hover:underline">Close</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 pb-28 flex-1">
            {step === "compare" && (
              <CompareStep
                group={group} compareType={compareType} allResolved={allResolved} includedIds={includedIds} setIncludedIds={setIncludedIds}
                records={records} comparison={comparison} lookups={lookups} safetyConflicts={safetyConflicts}
              />
            )}
            {step === "configure" && (
              <ConfigureStep
                records={records} masterCandidates={masterCandidates} recommendation={recommendation} effectiveMasterId={effectiveMasterId}
                setMasterOverride={setMasterOverride} comparison={comparison} fieldSelections={fieldSelections} setFieldChoice={setFieldChoice}
                safetyConflicts={safetyConflicts} ownerFieldChosen={ownerFieldChosen}
                consentAcknowledged={consentAcknowledged} setConsentAcknowledged={setConsentAcknowledged}
                lifecycleAcknowledged={lifecycleAcknowledged} setLifecycleAcknowledged={setLifecycleAcknowledged}
                currencyAcknowledged={currencyAcknowledged} setCurrencyAcknowledged={setCurrencyAcknowledged}
              />
            )}
            {step === "review" && (
              <ReviewStep
                compareType={compareType} master={master} absorbed={absorbed} changedFields={changedFields}
                fieldSelections={fieldSelections} requiredUnresolved={requiredUnresolved} reason={reason} setReason={setReason}
              />
            )}
          </div>
        )}

        {!result && (
          <div className="sticky bottom-0 bg-gray-950/95 backdrop-blur border-t border-gray-800 px-6 py-4 flex items-center justify-between">
            <button onClick={() => (step === "compare" ? onClose() : setStep(step === "review" ? "configure" : "compare"))} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">
              {step === "compare" ? "Close" : "Back"}
            </button>
            {step === "compare" && <button onClick={goToConfigure} disabled={included.length < 2} className="px-5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Continue</button>}
            {step === "configure" && <button onClick={goToReview} className="px-5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Preview Merge</button>}
            {step === "review" && (
              <button onClick={handleApply} disabled={!canApply || applying} className="px-5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
                {applying ? "Applying..." : "Apply Frontend Merge Preview"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IdentityCard({ recordType, record, isMaster, ctx }) {
  const meta = getIdentityMeta(recordType, record, ctx);
  return (
    <div className={`rounded-xl p-3 border ${isMaster ? "border-blue-600 bg-blue-900/10" : "border-gray-800 bg-gray-900/40"}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="font-medium">{record.name || record.email || "(unnamed)"}</p>
        {isMaster && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-700 text-white">Master</span>}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-gray-400">
        <div><dt className="inline">Created: </dt><dd className="inline text-gray-300">{new Date(meta.createdAt).toLocaleDateString()}</dd></div>
        <div><dt className="inline">Updated: </dt><dd className="inline text-gray-300">{new Date(meta.updatedAt).toLocaleDateString()}</dd></div>
        <div><dt className="inline">Owner: </dt><dd className="inline text-gray-300">{meta.owner}</dd></div>
        <div><dt className="inline">Source: </dt><dd className="inline text-gray-300">{meta.source}</dd></div>
        <div><dt className="inline">Activities: </dt><dd className="inline text-gray-300">{meta.activityCount}</dd></div>
        <div><dt className="inline">Related: </dt><dd className="inline text-gray-300">{meta.relatedCount}</dd></div>
        <div><dt className="inline">Completeness: </dt><dd className="inline text-gray-300">{meta.completenessPercent}%</dd></div>
        <div><dt className="inline">Archived: </dt><dd className="inline text-gray-300">{meta.archived ? "Yes" : "No"}</dd></div>
      </dl>
    </div>
  );
}

function SafetyBanners({ safetyConflicts }) {
  const entries = [
    safetyConflicts.consent && { key: "consent", text: safetyConflicts.consent.message },
    safetyConflicts.lifecycle && { key: "lifecycle", text: safetyConflicts.lifecycle.message },
    safetyConflicts.owner && { key: "owner", text: safetyConflicts.owner.message },
    safetyConflicts.currency && { key: "currency", text: safetyConflicts.currency.message },
    safetyConflicts.convertedLead && { key: "convertedLead", text: safetyConflicts.convertedLead.message },
  ].filter(Boolean);
  if (!entries.length) return null;
  return (
    <div className="space-y-2 mb-4" role="alert">
      {entries.map((e) => (
        <div key={e.key} className="flex items-start gap-2 bg-amber-900/10 border border-amber-800/30 rounded-lg p-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

function FieldComparisonTable({ comparison, records, mode, fieldSelections, setFieldChoice, masterId }) {
  return (
    <div className="overflow-x-auto border border-gray-800 rounded-xl">
      <table className="w-full text-sm min-w-150">
        <thead className="bg-gray-900/60 text-gray-400 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Field</th>
            {records.map((r) => (
              <th key={r._id} scope="col" className="px-3 py-2 font-medium">{r.name || r.email || r._id}{r._id === masterId && " (Master)"}</th>
            ))}
            {mode === "configure" && <th scope="col" className="px-3 py-2 font-medium">Final value</th>}
          </tr>
        </thead>
        <tbody>
          {comparison.map((field) => {
            const chosenId = fieldSelections?.[field.key] || masterId;
            const chosenEntry = field.entries.find((e) => e.recordId === chosenId);
            return (
              <tr key={field.key} className={`border-t border-gray-800 ${field.hasConflict ? "bg-red-900/5" : field.hasBlank ? "bg-amber-900/5" : ""}`}>
                <td className="px-3 py-2 text-gray-300 font-medium whitespace-nowrap">
                  {field.label}
                  {field.hasConflict && <span className="ml-2 text-[10px] text-red-300 border border-red-700 rounded-full px-1.5 py-0.5">Conflict</span>}
                  {!field.hasConflict && field.hasBlank && <span className="ml-2 text-[10px] text-amber-300 border border-amber-700 rounded-full px-1.5 py-0.5">Blank</span>}
                  {field.allMatch && <span className="ml-2 text-[10px] text-emerald-300 border border-emerald-700 rounded-full px-1.5 py-0.5">Match</span>}
                </td>
                {field.entries.map((e) => (
                  <td key={e.recordId} className="px-3 py-2 text-gray-300">
                    {mode === "configure" ? (
                      <button
                        onClick={() => setFieldChoice(field.key, e.recordId)}
                        aria-pressed={chosenId === e.recordId}
                        className={`text-left w-full px-2 py-1 rounded-lg border text-xs ${chosenId === e.recordId ? "border-blue-600 bg-blue-900/20 text-white" : "border-transparent hover:border-gray-700"}`}
                      >
                        {e.display}
                      </button>
                    ) : (
                      <span>{e.display}</span>
                    )}
                  </td>
                ))}
                {mode === "configure" && <td className="px-3 py-2 text-blue-300 font-medium">{chosenEntry?.display ?? "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompareStep({ group, allResolved, includedIds, setIncludedIds, records, comparison, lookups, safetyConflicts }) {
  const toggleIncluded = (id) => setIncludedIds((s) => {
    const next = new Set(s);
    if (next.has(id) && next.size > 2) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <div>
      {allResolved.length > 2 && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 mb-2">This group has {allResolved.length} records. Choose which ones to include in this merge (at least 2):</p>
          <div className="flex flex-wrap gap-2">
            {allResolved.map((r) => (
              <label key={r.id} className="flex items-center gap-1.5 text-sm bg-gray-900/40 border border-gray-800 rounded-full px-3 py-1.5">
                <input type="checkbox" checked={includedIds.has(r.id)} onChange={() => toggleIncluded(r.id)} />
                {r.record.name || r.record.email || r.id}
              </label>
            ))}
          </div>
        </div>
      )}
      <SafetyBanners safetyConflicts={safetyConflicts} />
      <h3 className="text-sm font-semibold mb-2">Record identity</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        {records.map((r) => <IdentityCard key={r._id} recordType={group.mixedTypes ? (allResolved.find((x) => x.id === r._id)?.type || group.recordType) : group.recordType} record={r} isMaster={false} ctx={{ activities, contacts: lookups.contacts && [...lookups.contacts.values()], deals: lookups.deals && [...lookups.deals.values()], relatedTypeLabel: ACTIVITY_TYPE_FOR }} />)}
      </div>
      <h3 className="text-sm font-semibold mb-2">Field comparison</h3>
      <p className="text-xs text-gray-500 mb-2">Explaining why these matched: {comparison ? null : null}</p>
      <FieldComparisonTable comparison={comparison} records={records} mode="compare" masterId={null} />
    </div>
  );
}

function ConfigureStep({
  records, masterCandidates, recommendation, effectiveMasterId, setMasterOverride, comparison, fieldSelections, setFieldChoice,
  safetyConflicts, ownerFieldChosen, consentAcknowledged, setConsentAcknowledged, lifecycleAcknowledged, setLifecycleAcknowledged,
  currencyAcknowledged, setCurrencyAcknowledged,
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Choose the master record</h3>
      {recommendation && (
        <p className="text-xs text-gray-400 mb-2 flex items-start gap-1.5"><Info size={14} className="shrink-0 mt-0.5" />
          Recommended: <strong className="text-gray-200 mx-1">{records.find((r) => r._id === recommendation.recordId)?.name || records.find((r) => r._id === recommendation.recordId)?.email}</strong>
          — {recommendation.reasons.join(", ")}. You can choose a different master.
        </p>
      )}
      {masterCandidates.length < records.length && (
        <p className="text-xs text-gray-500 mb-2">This is a Lead-to-Contact relationship — the existing Contact is always the master; the Lead is preserved and linked, not treated as an ordinary duplicate.</p>
      )}
      <div role="radiogroup" aria-label="Master record" className="flex flex-wrap gap-2 mb-4">
        {masterCandidates.map((r) => (
          <label key={r._id} className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-2 cursor-pointer ${effectiveMasterId === r._id ? "border-blue-600 bg-blue-900/10" : "border-gray-800"}`}>
            <input type="radio" name="master-record" checked={effectiveMasterId === r._id} onChange={() => setMasterOverride(r._id)} />
            {r.name || r.email} {recommendation?.recordId === r._id && <span className="text-[10px] text-blue-300">(Recommended)</span>}
          </label>
        ))}
      </div>

      {safetyConflicts.owner && (
        <div className="bg-amber-900/10 border border-amber-800/30 rounded-lg p-3 mb-3 text-sm">
          <p className="text-amber-200 flex items-center gap-1.5"><AlertTriangle size={14} /> {safetyConflicts.owner.message}</p>
          <p className="text-xs text-gray-400 mt-1.5">
            {ownerFieldChosen
              ? <span className="text-emerald-300">Owner chosen in the Owner row below.</span>
              : "Pick a value in the Owner row below to resolve this before continuing."}
          </p>
        </div>
      )}
      {safetyConflicts.consent && (
        <label className="flex items-start gap-2 bg-amber-900/10 border border-amber-800/30 rounded-lg p-3 mb-3 text-sm text-amber-200">
          <input type="checkbox" checked={consentAcknowledged} onChange={(e) => setConsentAcknowledged(e.target.checked)} className="mt-0.5" />
          <span>{safetyConflicts.consent.message} Reviewed and confirmed.</span>
        </label>
      )}
      {safetyConflicts.lifecycle && (
        <label className="flex items-start gap-2 bg-amber-900/10 border border-amber-800/30 rounded-lg p-3 mb-3 text-sm text-amber-200">
          <input type="checkbox" checked={lifecycleAcknowledged} onChange={(e) => setLifecycleAcknowledged(e.target.checked)} className="mt-0.5" />
          <span>{safetyConflicts.lifecycle.message} Reviewed and confirmed.</span>
        </label>
      )}
      {safetyConflicts.currency && (
        <label className="flex items-start gap-2 bg-amber-900/10 border border-amber-800/30 rounded-lg p-3 mb-3 text-sm text-amber-200">
          <input type="checkbox" checked={currencyAcknowledged} onChange={(e) => setCurrencyAcknowledged(e.target.checked)} className="mt-0.5" />
          <span>{safetyConflicts.currency.message} Reviewed and confirmed.</span>
        </label>
      )}

      <h3 className="text-sm font-semibold mb-2 mt-4">Choose the final value for each field</h3>
      <p className="text-xs text-gray-500 mb-2">Defaults to the master&apos;s own value — click any other cell to use that record&apos;s value instead.</p>
      <FieldComparisonTable comparison={comparison} records={records} mode="configure" fieldSelections={fieldSelections} setFieldChoice={setFieldChoice} masterId={effectiveMasterId} />
    </div>
  );
}

function ReviewStep({ compareType, master, absorbed, changedFields, fieldSelections, requiredUnresolved, reason, setReason }) {
  const relatedForMaster = master ? relatedRecordsFor(compareType, master) : [];
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Merge preview summary</h3>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 mb-4 text-sm space-y-1">
        <p><span className="text-gray-500">Selected master: </span><strong>{master?.name || master?.email}</strong></p>
        <p><span className="text-gray-500">Records absorbed: </span>{absorbed.map((r) => r.name || r.email).join(", ") || "None"}</p>
        <p><span className="text-gray-500">Reason required: </span>{reason.trim() ? "Provided" : "Not yet provided"}</p>
      </div>

      <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Final field values (only changes from the master shown)</h4>
      {changedFields.length === 0 ? (
        <p className="text-sm text-gray-500 mb-4">No fields were changed from the master&apos;s own values.</p>
      ) : (
        <ul className="text-sm mb-4 space-y-1">
          {changedFields.map((f) => {
            const chosenId = fieldSelections[f.key];
            const chosen = f.entries.find((e) => e.recordId === chosenId);
            return <li key={f.key}><span className="text-gray-500">{f.label}: </span>{chosen?.display}</li>;
          })}
        </ul>
      )}

      <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Related records that would move to the master</h4>
      <div className="flex flex-wrap gap-2 mb-4">
        {relatedForMaster.map((r) => (
          <span key={r.label} className="text-xs bg-gray-900/40 border border-gray-800 rounded-full px-3 py-1">{r.label}: {r.count} (already on master, kept as-is)</span>
        ))}
      </div>
      <p className="text-xs text-gray-500 mb-4">Absorbed record{absorbed.length === 1 ? "" : "s"}&apos; own activities/tasks/files stay with that record’s history and are preserved (not deleted) — they are not automatically relinked to the master in this preview.</p>

      {requiredUnresolved.length > 0 ? (
        <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3 mb-4 text-sm text-red-200">
          <p className="font-medium mb-1 flex items-center gap-1.5"><AlertTriangle size={14} /> Unresolved conflicts — confirmation is disabled until these are resolved:</p>
          <ul className="list-disc list-inside">{requiredUnresolved.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      ) : (
        <p className="text-sm text-emerald-300 mb-4 flex items-center gap-1.5"><CheckCircle2 size={14} /> All required conflicts are resolved.</p>
      )}

      <label className="block text-xs text-gray-400 mb-1">Reason for this merge (required)</label>
      <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why are these the same record?" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none mb-3" />

      <div className="bg-blue-900/10 border border-blue-800/30 rounded-lg p-3 text-sm text-blue-200">
        This changes only the current frontend session. No production records will be merged or deleted.
      </div>
    </div>
  );
}
