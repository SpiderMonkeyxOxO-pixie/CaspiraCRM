// How the signed-in user is shown across the app. The backend sends
// fullName/name; the old mock data used FullName.
// eslint-disable-next-line react-refresh/only-export-components -- the helper belongs with the avatar
export function displayName(user) {
  return user?.fullName || user?.name || user?.FullName || user?.username || "";
}

function initials(user) {
  const parts = displayName(user).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// A coloured circle with the user's initials (no photo storage yet).
export function InitialsAvatar({ user, size = 36, className = "" }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-full bg-blue-600 text-white font-semibold flex items-center justify-center shrink-0 select-none ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(user)}
    </div>
  );
}
