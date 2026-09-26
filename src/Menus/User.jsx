import { LogOut } from "lucide-react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { logout } from "../redux/authSlice";
import { getRoleLabel } from "../utils/roleLabels";
import { InitialsAvatar, displayName } from "../components/account/accountDisplay";

// Hover card for the user in the sidebar footer.
function UserMenu({ openUser, userData }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  if (!openUser) return null;

  const handleLogout = async (event) => {
    event.preventDefault();
    const res = await dispatch(logout());
    if (logout.fulfilled.match(res)) navigate("/");
  };

  const rows = [
    ["Username", userData?.username ? `@${userData.username.replace(/^@/, "")}` : null],
    ["Role", getRoleLabel(userData?.role)],
    ["Department", userData?.department],
    ["Shift", userData?.shift || userData?.Shift],
    ["Status", userData?.status],
  ].filter(([, v]) => v);

  return (
    <div className="absolute bottom-full -left-14 mb-2 w-60 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl z-[9999] text-sm p-4">
      <div className="flex flex-col items-center text-center">
        <InitialsAvatar user={userData} size={56} />
        <p className="mt-2 font-semibold text-white break-words">{displayName(userData)}</p>
        {userData?.email && <p className="text-xs text-gray-400 break-all">{userData.email}</p>}
      </div>
      <div className="border-t border-gray-700 my-3" />
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-gray-400">{label}</dt>
            <dd className={`text-right ${label === "Status" && value === "Active" ? "text-emerald-400" : "text-white"}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-gray-700 my-3" />
      <button type="button" onClick={handleLogout}
        className="w-full py-2 px-2 flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/15">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}

export default UserMenu;
