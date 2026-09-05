import {
  PhoneCall, Mail, Users, RefreshCcw, ListChecks, StickyNote, MapPin, Bell,
} from "lucide-react";

export const TYPE_ICONS = {
  Call: PhoneCall, Email: Mail, Meeting: Users, "Follow-up": RefreshCcw,
  Task: ListChecks, Note: StickyNote, "Customer Visit": MapPin, "Status Update": Bell,
};

export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
