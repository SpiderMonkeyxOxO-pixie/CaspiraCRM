import React, { useState } from 'react';
import {
    Shield,
    LogOut,
    Trash2,
    AlertCircle,
    Bell,
    Eye,
    EyeOff,
    Lock,
    CheckCircle,
    XCircle
} from "lucide-react";
import toast from "react-hot-toast";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { deleteAccount, logout } from "../../redux/authSlice";

function Security({ activeTab }) {
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const [twoFA, setTwoFA] = useState(true);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteForm, setDeleteForm] = useState({
        password: "",
        confirmation: ""
    });
    const [showPassword, setShowPassword] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleRevokeSession = (device) => {
        toast.success(`Session for ${device} has been revoked`);
    };

    const handleLogoutAll = async (event) => {
        event.preventDefault();
        const res = await dispatch(logout());
        if (res?.payload?.success) navigate("/");
        toast.success("Logged out from all devices");
    };

    const handleDeleteAccount = async () => {
        // Validation
        if (!deleteForm.password) {
            toast.error("Please enter your password");
            return;
        }

        if (deleteForm.confirmation !== "DELETE MY ACCOUNT") {
            toast.error("Please type 'DELETE MY ACCOUNT' to confirm");
            return;
        }

        setIsDeleting(true);

        try {
            // Generate confirmation token
            const confirmationToken = Math.random().toString(36).substring(2) +
                Date.now().toString(36);

            const result = await dispatch(deleteAccount({
                password: deleteForm.password,
                confirmationToken
            })).unwrap();

            if (result.success) {
                toast.success(result.message || "Account deleted successfully");

                // Logout and redirect
                setTimeout(() => {
                    dispatch(logout());
                    navigate("/");
                }, 2000);
            }
        } catch (error) {
            toast.error(error || "Failed to delete account");
        } finally {
            setIsDeleting(false);
            setDeleteModalOpen(false);
            setDeleteForm({ password: "", confirmation: "" });
        }
    };

    const handleDeleteModalOpen = () => {
        setDeleteModalOpen(true);
        setDeleteForm({ password: "", confirmation: "" });
    };

    const isDeleteReady = deleteForm.password && deleteForm.confirmation === "DELETE MY ACCOUNT";

    if (activeTab !== "security") return null;

    return (
        <>
            <div className="space-y-6">
                <div className="bg-[#9696a814] border border-gray-700 rounded-xl p-6">
                    <div className="mb-8">
                        <h3 className="text-2xl font-bold text-white mb-2">Security Settings</h3>
                        <p className="text-gray-400">Manage your account security and authentication</p>
                    </div>

                    <div className="space-y-6">
                        {/* Two-Factor Authentication */}
                        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-900/30 rounded-lg">
                                        <Shield className="text-blue-400" size={20} />
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-white">Two-Factor Authentication</h4>
                                        <p className="text-sm text-gray-400">Enhanced account security</p>
                                    </div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={twoFA}
                                        onChange={() => setTwoFA(!twoFA)}
                                    />
                                    <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>
                            <p className="text-gray-400 text-sm mb-4">
                                Enable 2FA for extra security. You'll need a verification code from your authentication app to sign in.
                            </p>
                            {twoFA && (
                                <div className="mt-4 p-4 bg-green-900/20 border border-green-800/50 rounded-lg">
                                    <div className="flex items-center gap-2 text-green-400">
                                        <Shield size={16} />
                                        <span className="font-medium">2FA is active</span>
                                    </div>
                                    <p className="text-sm text-green-500 mt-1">
                                        Your account is protected with two-factor authentication
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Session Management */}
                        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-6">
                            <h4 className="text-lg font-bold text-white mb-4">Active Sessions</h4>
                            <div className="space-y-3">
                                {[
                                    { device: "Chrome on Windows", location: "Mumbai, IN", current: true, time: "Now" },
                                    { device: "Safari on iPhone", location: "Delhi, IN", current: false, time: "2 hours ago" },
                                    { device: "Firefox on Mac", location: "Bangalore, IN", current: false, time: "1 day ago" }
                                ].map((session, index) => (
                                    <div key={index} className="flex items-center justify-between p-3 bg-[#9696a814] rounded-lg">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-white">{session.device}</span>
                                                {session.current && (
                                                    <span className="bg-green-900/30 text-green-400 text-xs px-2 py-0.5 rounded">Current</span>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-400">
                                                {session.location} • {session.time}
                                            </div>
                                        </div>
                                        {!session.current && (
                                            <button
                                                onClick={() => handleRevokeSession(session.device)}
                                                className="text-red-400 hover:text-red-300 text-sm font-medium"
                                            >
                                                Revoke
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Security Settings */}
                        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-6">
                            <h4 className="text-lg font-bold text-white mb-4">Security Preferences</h4>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <Bell size={16} className="text-gray-400" />
                                            <div className="font-medium text-white">Login Notifications</div>
                                        </div>
                                        <div className="text-sm text-gray-400">Get notified for new logins</div>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" className="sr-only peer" defaultChecked />
                                        <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                    </label>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-medium text-white">Password Reset Protection</div>
                                        <div className="text-sm text-gray-400">Require email confirmation for password reset</div>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" className="sr-only peer" defaultChecked />
                                        <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Danger Zone */}
                        <div className="bg-red-900/10 border border-red-900/50 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <AlertCircle className="text-red-400" size={24} />
                                <h4 className="text-xl font-bold text-red-400">Danger Zone</h4>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-4 border border-red-900/30 rounded-lg bg-red-900/20">
                                    <div className="flex items-center gap-3">
                                        <LogOut className="text-red-400" size={20} />
                                        <div>
                                            <div className="font-bold text-red-300">Logout All Sessions</div>
                                            <div className="text-sm text-red-400/80">Logout from all devices except this one</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleLogoutAll}
                                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition"
                                    >
                                        Logout All
                                    </button>
                                </div>

                                <div className="flex items-center justify-between p-4 border border-red-900/30 rounded-lg bg-red-900/20">
                                    <div className="flex items-center gap-3">
                                        <Trash2 className="text-red-400" size={20} />
                                        <div>
                                            <div className="font-bold text-red-300">Delete Account</div>
                                            <div className="text-sm text-red-400/80">Permanently delete your account and all data</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleDeleteModalOpen}
                                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition"
                                    >
                                        Delete Account
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete Account Modal */}
            {deleteModalOpen && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 animate-in fade-in zoom-in">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-900/30 rounded-lg">
                                    <Trash2 className="text-red-400" size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white">Delete Account</h3>
                                    <p className="text-sm text-gray-400">This action cannot be undone</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setDeleteModalOpen(false)}
                                className="text-gray-400 hover:text-white transition"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-lg">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="text-red-400 mt-0.5" size={20} />
                                    <div>
                                        <h4 className="font-bold text-red-300 mb-1">Warning</h4>
                                        <p className="text-sm text-red-400/80">
                                            Deleting your account will:
                                        </p>
                                        <ul className="text-sm text-red-400/80 mt-2 space-y-1">
                                            <li className="flex items-center gap-2">
                                                <XCircle size={14} />
                                                Permanently delete all your data
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <XCircle size={14} />
                                                Remove all your quota settings
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <XCircle size={14} />
                                                Delete your profile and history
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <XCircle size={14} />
                                                This action cannot be reversed
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-gray-300 font-medium mb-2">
                                    Enter Password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={deleteForm.password}
                                        onChange={(e) => setDeleteForm(prev => ({
                                            ...prev,
                                            password: e.target.value
                                        }))}
                                        placeholder="Your current password"
                                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-3.5 text-gray-500 hover:text-gray-300"
                                    >
                                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-gray-300 font-medium mb-2">
                                    Type <span className="font-mono text-red-400">DELETE MY ACCOUNT</span> to confirm
                                </label>
                                <input
                                    type="text"
                                    value={deleteForm.confirmation}
                                    onChange={(e) => setDeleteForm(prev => ({
                                        ...prev,
                                        confirmation: e.target.value
                                    }))}
                                    placeholder="DELETE MY ACCOUNT"
                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent uppercase"
                                />
                                <div className="flex items-center gap-2 mt-2">
                                    {deleteForm.confirmation === "DELETE MY ACCOUNT" ? (
                                        <>
                                            <CheckCircle className="text-green-400" size={16} />
                                            <span className="text-sm text-green-400">Confirmation matches</span>
                                        </>
                                    ) : deleteForm.confirmation ? (
                                        <>
                                            <XCircle className="text-red-400" size={16} />
                                            <span className="text-sm text-red-400">Please type exactly: DELETE MY ACCOUNT</span>
                                        </>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteModalOpen(false)}
                                disabled={isDeleting}
                                className="px-5 py-2.5 border border-gray-600 text-gray-300 hover:bg-gray-800 rounded-lg font-medium transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteAccount}
                                disabled={!isDeleteReady || isDeleting}
                                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-900 disabled:cursor-not-allowed text-white rounded-lg font-medium transition flex items-center gap-2"
                            >
                                {isDeleting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        Deleting...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 size={18} />
                                        Delete Account Permanently
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default Security;