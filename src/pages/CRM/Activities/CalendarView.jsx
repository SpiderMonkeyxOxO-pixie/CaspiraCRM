import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { Calendar as BigCalendar, dateFnsLocalizer, Views } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import format from "date-fns/format";
import parse from "date-fns/parse";
import getDay from "date-fns/getDay";
import startOfWeek from "date-fns/startOfWeek";
import enUS from "date-fns/locale/en-US";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import { ChevronLeft, ChevronRight, Globe, AlertTriangle } from "lucide-react";
import { rescheduleActivity } from "../../../redux/crm/activitiesSlice";
import { findConflicts, ACTIVITY_TYPES } from "../../../Helpers/mockActivitiesData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import { TypeIcon } from "./ActivityBadges";

const localizer = dateFnsLocalizer({ format, parse, startOfWeek: (d) => startOfWeek(d, { weekStartsOn: 1 }), getDay, locales: { "en-US": enUS } });
const DnDCalendar = withDragAndDrop(BigCalendar);

function CustomToolbar({ label, onNavigate, onView, view, ownerFilter, setOwnerFilter, typeFilter, setTypeFilter }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <button onClick={() => onNavigate("TODAY")} className="px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm">Today</button>
        <button onClick={() => onNavigate("PREV")} aria-label="Previous period" className="p-1.5 rounded-lg border border-gray-700 hover:bg-gray-800"><ChevronLeft size={16} /></button>
        <button onClick={() => onNavigate("NEXT")} aria-label="Next period" className="p-1.5 rounded-lg border border-gray-700 hover:bg-gray-800"><ChevronRight size={16} /></button>
        <span className="text-sm font-medium ml-2">{label}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-2 py-1.5 text-xs" aria-label="Filter calendar by owner">
          <option value="">All Owners</option>
          {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-2 py-1.5 text-xs" aria-label="Filter calendar by activity type">
          <option value="">All Types</option>
          {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="flex items-center gap-1 text-xs text-gray-500" title="Times shown in your local time zone"><Globe size={12} /> Local time</span>
        <div className="flex gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-0.5">
          {[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA].map((v) => (
            <button key={v} onClick={() => onView(v)} className={`px-2 py-1 rounded text-xs capitalize ${view === v ? "bg-blue-700 text-white" : "text-gray-400 hover:text-gray-200"}`}>{v}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventContent({ event }) {
  return (
    <span className="flex items-center gap-1 text-xs">
      <TypeIcon type={event.resource.type} size={11} />
      <span className="truncate">{event.title}</span>
    </span>
  );
}

export default function CalendarView({ activities, onOpen, onCreateAt }) {
  const dispatch = useDispatch();
  const [view, setView] = useState(Views.MONTH);
  const [date, setDate] = useState(new Date());
  const [ownerFilter, setOwnerFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [pendingReschedule, setPendingReschedule] = useState(null); // { activity, start, end, conflicts }

  const filtered = activities.filter((a) => (!ownerFilter || a.ownerId === ownerFilter) && (!typeFilter || a.type === typeFilter));
  const events = useMemo(() => filtered
    .filter((a) => a.startAt)
    .map((a) => ({
      id: a._id,
      title: a.title,
      start: new Date(a.startAt),
      end: a.endAt ? new Date(a.endAt) : new Date(new Date(a.startAt).getTime() + 30 * 60 * 1000),
      resource: a,
    })), [filtered]);

  const handleSelectSlot = ({ start }) => onCreateAt(start);
  const handleSelectEvent = (event) => onOpen(event.resource);

  const proposeMove = (event, start, end) => {
    const proposed = { ...event.resource, startAt: start.toISOString(), endAt: end.toISOString() };
    const conflicts = findConflicts(proposed, activities);
    setPendingReschedule({ activity: event.resource, start, end, conflicts });
  };

  const confirmReschedule = () => {
    const { activity, start, end } = pendingReschedule;
    dispatch(rescheduleActivity({ id: activity._id, startAt: start.toISOString(), endAt: end.toISOString(), timezone: activity.timezone, reminder: activity.reminder }));
    setPendingReschedule(null);
  };

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <DnDCalendar
        localizer={localizer}
        events={events}
        view={view}
        date={date}
        onView={setView}
        onNavigate={setDate}
        views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
        style={{ height: 620 }}
        selectable
        resizable
        popup
        onSelectSlot={handleSelectSlot}
        onSelectEvent={handleSelectEvent}
        onEventDrop={({ event, start, end }) => proposeMove(event, start, end)}
        onEventResize={({ event, start, end }) => proposeMove(event, start, end)}
        components={{
          toolbar: (props) => <CustomToolbar {...props} ownerFilter={ownerFilter} setOwnerFilter={setOwnerFilter} typeFilter={typeFilter} setTypeFilter={setTypeFilter} />,
          event: EventContent,
        }}
        eventPropGetter={(event) => {
          const terminal = ["Completed", "Cancelled"].includes(event.resource.status);
          return { style: { backgroundColor: terminal ? "#4b5563" : "#1d4ed8", borderRadius: 4, opacity: terminal ? 0.6 : 1 } };
        }}
      />
      <p className="text-[11px] text-gray-500 mt-3">Drag, drop and resize update this frontend preview only — no external calendar is connected.</p>

      {pendingReschedule && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setPendingReschedule(null)}>
          <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold">Confirm reschedule</h3>
            <p className="text-sm text-gray-400">
              Move <strong className="text-white">{pendingReschedule.activity.title}</strong> to{" "}
              {pendingReschedule.start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}?
            </p>
            {pendingReschedule.conflicts.length > 0 && (
              <div className="bg-amber-900/15 border border-amber-800/40 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>This conflicts with {pendingReschedule.conflicts.length} other scheduled activit{pendingReschedule.conflicts.length === 1 ? "y" : "ies"} for this owner. You can still proceed.</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingReschedule(null)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button onClick={confirmReschedule} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">
                {pendingReschedule.conflicts.length > 0 ? "Override & Reschedule" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
