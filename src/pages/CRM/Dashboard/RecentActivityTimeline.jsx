import { Link } from "react-router-dom";
import {
  UserPlus, CheckCircle2, Building2, ArrowRightCircle, Trophy, XCircle, PhoneCall, CalendarClock,
} from "lucide-react";

const EVENT_ICONS = {
  lead_created: UserPlus, lead_converted: CheckCircle2, contact_added: UserPlus, company_created: Building2,
  deal_stage_changed: ArrowRightCircle, deal_won: Trophy, deal_lost: XCircle, activity_completed: PhoneCall,
  followup_scheduled: CalendarClock,
};

function formatAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) {
    const hours = Math.floor(ms / 3600000);
    if (hours < 1) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export default function RecentActivityTimeline({ events }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h2 className="font-semibold text-sm mb-3">Recent CRM Activity</h2>
      {events.length === 0 ? (
        <p className="text-sm text-gray-500">No recent activity in the active filters.</p>
      ) : (
        <ul className="space-y-3 max-h-80 overflow-y-auto">
          {events.map((e, i) => {
            const Icon = EVENT_ICONS[e.type] || ArrowRightCircle;
            const body = (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center shrink-0"><Icon size={13} className="text-blue-400" /></div>
                <div className="min-w-0">
                  <p className="text-sm truncate">{e.label}</p>
                  <p className="text-[11px] text-gray-500">{formatAgo(e.at)}</p>
                </div>
              </div>
            );
            return (
              <li key={`${e.type}-${e.at}-${i}`}>
                {e.to ? <Link to={e.to} className="block hover:bg-gray-800/40 rounded-lg -mx-1 px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500">{body}</Link> : body}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
