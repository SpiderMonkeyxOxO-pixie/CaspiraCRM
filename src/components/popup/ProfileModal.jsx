import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { getRoleLabel } from "../../utils/roleLabels";
import { InitialsAvatar, displayName } from "../account/accountDisplay";

// Read-only summary of the signed-in user; changes are made in Settings.
export default function ProfileModal({ isOpen, onClose, onEdit, user }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const rows = [
    ["Username", user?.username ? `@${user.username.replace(/^@/, "")}` : "—"],
    ["Email", user?.email || "—"],
    ["Phone", user?.phone],
    ["Role", getRoleLabel(user?.role) || "—"],
    ["Two-factor authentication", user?.twoFactorEnabled ? "On" : "Off"],
  ].filter(([, value]) => value);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <motion.div
            role="dialog" aria-modal="true" aria-labelledby="profile-title"
            className="relative w-[440px] max-w-full rounded-2xl shadow-2xl border border-gray-700 bg-gray-900 text-white p-6"
            initial={{ y: 20, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", damping: 25, stiffness: 250 }}
          >
            <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-gray-400 hover:text-white">
              <X size={18} />
            </button>
            <div className="flex items-center gap-4">
              <InitialsAvatar user={user} size={56} />
              <div className="min-w-0">
                <h3 id="profile-title" className="text-lg font-semibold text-white truncate">{displayName(user) || "Your profile"}</h3>
                <p className="text-sm text-gray-400 truncate">{getRoleLabel(user?.role)}</p>
              </div>
            </div>
            <dl className="mt-5 border-y border-gray-800 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2.5 border-b border-gray-800 last:border-b-0">
                  <dt className="text-gray-400">{label}</dt>
                  <dd className="text-white text-right break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-800">Close</button>
              <button type="button" onClick={onEdit} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">Edit in Settings</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
