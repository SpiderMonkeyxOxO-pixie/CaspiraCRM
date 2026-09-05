import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getRoleLabel } from "../../utils/roleLabels";

export default function ProfileModal({ isOpen, onClose, user }) {
  const [formData, setFormData] = useState({ username: "", email: "", role: "" });

  useEffect(() => {
    if (user) setFormData(user);
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    console.log("Updated Data:", formData);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          aria-modal="true"
          role="dialog"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal Card */}
          <motion.div
            className="relative w-[480px] max-w-full rounded-2xl shadow-2xl border border-[var(--box-border)] bg-[#3b83f60e] p-6 z-10 text-gray-200"
            initial={{ y: 25, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 25, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 250 }}
          >
            <div className="flex items-start justify-between border-b border-gray-700 pb-3">
              <h3 className="text-lg font-semibold text-white">User Profile</h3>
              <button
                onClick={onClose}
                aria-label="close"
                className="text-gray-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Username</label>
                <input
                  name="username"
                  className="w-full rounded-md border border-gray-600 bg-[#1e293b] focus:border-sky-500 focus:ring-1 focus:ring-sky-500 px-3 py-2 text-sm text-gray-100 outline-none transition"
                  value={formData.username}
                  onChange={handleChange}
                  readOnly
                  placeholder="Enter username"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input
                  name="email"
                  className="w-full rounded-md border border-gray-600 bg-[#1e293b] focus:border-sky-500 focus:ring-1 focus:ring-sky-500 px-3 py-2 text-sm text-gray-100 outline-none transition"
                  value={formData.email}
                  readOnly
                  onChange={handleChange}
                  placeholder="Enter email"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Role</label>
                <input
                  name="role"
                  className="w-full rounded-md border border-gray-600 bg-[#1e293b] focus:border-sky-500 focus:ring-1 focus:ring-sky-500 px-3 py-2 text-sm text-gray-100 outline-none transition"
                  value={getRoleLabel(formData.role)}
                  readOnly
                  onChange={handleChange}
                  placeholder="Enter role"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 pt-4">
              <button
                className="px-4 py-2 rounded-md bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 transition"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-md bg-sky-600 text-white text-sm hover:bg-sky-500 shadow-sm transition"
                onClick={handleSave}
              >
                Save Changes
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
