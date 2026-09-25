import { useState } from "react";
import toast from "react-hot-toast";
import { useDispatch, useSelector } from "react-redux";
import { changePassword, getUserData, updateProfile } from "../../redux/authSlice";
import {
    ArrowRight, Eye, EyeOff, Lock, LogOut, Trash2, TriangleAlert,
    User, Settings as SettingsIcon, UserCircle, Shield, Mail
} from "lucide-react";
import Security from "./Security";

function Settings() {
    const dispatch = useDispatch();
    const userData = useSelector((state) => state?.auth?.data);

    const [activeTab, setActiveTab] = useState("basic-details");
    const [previewImage, setImagePreview] = useState(userData?.avatar?.url || "");

    const [userPassword, setUserPassword] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
    });

    const [showPasswords, setShowPasswords] = useState({
        current: false,
        new: false,
        confirm: false
    });

    const [userInfo, setUserInfo] = useState({
        FullName: userData?.FullName || "",
        email: userData?.email || "",
        phone: userData?.phone || "",
        avatar: undefined,
        userID: userData?._id,
        password:userData?.password
    });

    // Password handling functions
    const handlePasswordChange = (event) => {
        const { name, value } = event.target;
        setUserPassword(prev => ({
            ...prev,
            [name]: value,
        }));
    };


    const getPasswordStrength = (password) => {
        if (!password) return { strength: 0, label: 'Weak', color: 'bg-red-500' };

        let score = 0;
        const checks = {
            length: password.length >= 8,
            lowercase: /[a-z]/.test(password),
            uppercase: /[A-Z]/.test(password),
            numbers: /\d/.test(password),
            special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
        };

        score = Object.values(checks).filter(Boolean).length;

        if (score <= 2) {
            return { strength: score, label: 'Weak', color: 'bg-red-500' };
        } else if (score <= 3) {
            return { strength: score, label: 'Medium', color: 'bg-yellow-500' };
        } else {
            return { strength: score, label: 'Strong', color: 'bg-green-500' };
        }
    };

    const passwordStrength = getPasswordStrength(userPassword.newPassword);

    // Image upload handler
    const handleImageUpload = (event) => {
        const uploadedImage = event.target.files[0];
        if (!uploadedImage) return;

        if (uploadedImage.size > 5 * 1024 * 1024) {
            toast.error("Image size should be less than 5MB");
            return;
        }

        setUserInfo(prev => ({
            ...prev,
            avatar: uploadedImage,
        }));

        const fileReader = new FileReader();
        fileReader.readAsDataURL(uploadedImage);
        fileReader.onload = function () {
            setImagePreview(this.result);
        };
    };

    const handleUserInfoChange = (event) => {
        const { name, value } = event.target;
        setUserInfo(prev => ({ ...prev, [name]: value }));
    };

    const handleUpdateProfile = async (event) => {
        event.preventDefault();

        if (!userInfo.FullName.trim()) {
            toast.error("Name is required");
            return;
        }

        if (userInfo.FullName.length < 3) {
            toast.error("Name should have at least 3 characters");
            return;
        }

        try {
            const formData = new FormData();
            formData.append("FullName", userInfo.FullName);
            formData.append("phone", userInfo.phone);
            if (userInfo.avatar) {
                formData.append("avatar", userInfo.avatar);
            }

            const res = await dispatch(updateProfile([userInfo.userID, formData]));

            if (res?.payload?.success) {
                toast.success("Profile updated successfully!");
                await dispatch(getUserData());
            } else {
                toast.error(res?.payload?.message || "Failed to update profile");
            }
        } catch {
            toast.error("Something went wrong!");
        }
    };

    const handleUpdatePassword = async (event) => {
        event.preventDefault();

        if (!userPassword.currentPassword || !userPassword.newPassword) {
            toast.error("All fields are mandatory");
            return;
        }

        if (userPassword.newPassword !== userPassword.confirmPassword) {
            toast.error("New passwords don't match");
            return;
        }

        if (userPassword.newPassword.length < 6) {
            toast.error("Password should be at least 6 characters long");
            return;
        }

        if (!/(?=.*[A-Z])(?=.*[!@#$%^&*])/.test(userPassword.newPassword)) {
            toast.error("Password must contain at least one uppercase letter and one special character");
            return;
        }

        const res = await dispatch(changePassword({
            currentPassword: userPassword.currentPassword,
            newPassword: userPassword.newPassword
        }));

        if (res?.payload?.success) {
            toast.success("Password updated successfully!");
            setUserPassword({
                currentPassword: "",
                newPassword: "",
                confirmPassword: ""
            });
        } else {
            toast.error(res?.payload?.message || "Failed to update password");
        }
    };

    // Settings Menu Items
    const settingsMenu = [
        { id: "basic-details", label: "Basic Details", icon: <UserCircle size={20} /> },
        { id: "security", label: "Security", icon: <Shield size={20} /> },
    ];

    return (
        <div className="min-h-screen text-white p-4 md:p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <SettingsIcon className="text-blue-400" size={28} />
                    <h2 className="text-2xl font-bold text-white">Settings</h2>
                </div>
                <div className="text-sm text-gray-400">
                    Last updated: {new Date().toLocaleDateString()}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
                {/* Sidebar Navigation */}
                <div className="lg:w-1/4">
                    <div className="bg-[#9696a814] border border-gray-700 rounded-xl p-4 sticky top-6">
                        <h3 className="text-lg font-semibold text-gray-300 mb-4 px-2">Navigation</h3>
                        <div className="space-y-1">
                            {settingsMenu.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveTab(item.id)}
                                    className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === item.id
                                        ? "bg-[#9696a814] border-l-[3px] text-[#3b82f6] shadow-lg"
                                        : "text-gray-400 hover:bg-[#9696a814]  hover:text-gray-300"
                                        }`}
                                >
                                    <div className={`p-1.5 rounded ${activeTab === item.id ? 'bg-blue-900/30' : 'bg-gray-700'
                                        }`}>
                                        {item.icon}
                                    </div>
                                    <span className="font-medium">{item.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="lg:w-3/4">
                    {/* Basic Details Section */}
                    {activeTab === "basic-details" && (
                        <div className="space-y-6">
                            {/* Profile Card */}
                            <div className="bg-[#9696a814] border border-gray-700 rounded-xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xl font-bold text-white">Basic Details</h3>
                                    <div className="text-sm text-gray-400">
                                        User ID: <span className="font-mono text-gray-300">{userInfo.userID?.substring(0, 8)}...</span>
                                    </div>
                                </div>

                                <form onSubmit={handleUpdateProfile}>
                                    <div className="flex flex-col md:flex-row items-start gap-6 mb-8">
                                        {/* Avatar Upload */}
                                        <div className="flex flex-col items-center">
                                            <label className="cursor-pointer group" htmlFor="avatar-upload">
                                                <div className="relative">
                                                    {previewImage ? (
                                                        <img
                                                            className="w-32 h-32 rounded-full border-4 border-gray-700 shadow-lg object-cover"
                                                            src={
                                                                previewImage ||
                                                                userData?.avatar?.url ||
                                                                "/default-avatar.png"
                                                            }
                                                        />
                                                    ) : (
                                                        <div className="w-32 h-32 rounded-full border-4 border-gray-700 bg-gradient-to-br from-gray-800 to-gray-900 shadow-lg flex items-center justify-center">
                                                            <User className="w-16 h-16 text-gray-500" />
                                                        </div>
                                                    )}
                                                    <div className="absolute inset-0 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <span className="text-white text-sm font-medium">Change</span>
                                                    </div>
                                                </div>
                                            </label>
                                            <input
                                                onChange={handleImageUpload}
                                                className="hidden"
                                                type="file"
                                                id="avatar-upload"
                                                accept="image/*"
                                            />
                                            <p className="text-sm text-gray-400 mt-3 text-center">
                                                Click to upload (Max 5MB)<br />
                                                JPG, PNG, GIF supported
                                            </p>
                                        </div>

                                        {/* User Info */}
                                        <div className="flex-1 space-y-4">
                                            <div>
                                                <label className="block text-gray-300 font-medium mb-2">
                                                    Full Name *
                                                </label>
                                                <input
                                                    type="text"
                                                    name="name"
                                                    value={userInfo.FullName}
                                                    onChange={handleUserInfoChange}
                                                    placeholder="Enter your full name"
                                                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-gray-300 font-medium mb-2 flex items-center gap-2">
                                                    <Mail size={16} /> Email Address
                                                </label>
                                                <input
                                                    type="email"
                                                    value={userInfo.email}
                                                    disabled
                                                    className="w-full bg-[#9696a814] border border-gray-600 rounded-lg px-4 py-3 text-gray-400 cursor-not-allowed"
                                                />
                                                <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                                            </div>

                                            <div>
                                                <label className="block text-gray-300 font-medium mb-2">
                                                    Phone Number
                                                </label>
                                                <input
                                                    type="tel"
                                                    name="phone"
                                                    value={userInfo.phone}
                                                    onChange={handleUserInfoChange}
                                                    placeholder="Enter phone number"
                                                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-3">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setUserInfo({
                                                    name: userData?.name || "",
                                                    email: userData?.email || "",
                                                    phone: userData?.phone || "",
                                                    avatar: undefined,
                                                    userID: userData?._id,
                                                });
                                                setImagePreview(userData?.avatar || "");
                                            }}
                                            className="px-5 py-2.5 border border-gray-600 rounded-lg font-medium text-gray-300 hover:bg-gray-700 transition"
                                        >
                                            Reset
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={!userInfo?.name?.trim()}
                                            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition"
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Change Password */}
                            <form onSubmit={handleUpdatePassword} className="bg-[#9696a814] border border-gray-700 rounded-xl p-6">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-blue-900/30 rounded-lg">
                                        <Lock className="text-blue-400" size={20} />
                                    </div>
                                    <h3 className="text-xl font-bold text-white">Change Password</h3>
                                </div>

                                <div className="grid md:grid-cols-2 gap-6 mb-6">
                                    <div>
                                        <label className="block text-gray-300 font-medium mb-2">
                                            Current Password
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords.current ? "text" : "password"}
                                                name="currentPassword"
                                                value={userInfo.password||userPassword.currentPassword}
                                                onChange={handlePasswordChange}
                                                placeholder="Enter current password"
                                                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                                                className="absolute right-4 top-3.5 text-gray-500 hover:text-gray-300"
                                            >
                                                {showPasswords.current ? <EyeOff size={20} /> : <Eye size={20} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-gray-300 font-medium mb-2">
                                            New Password
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords.new ? "text" : "password"}
                                                name="newPassword"
                                                value={userPassword.newPassword}
                                                onChange={handlePasswordChange}
                                                placeholder="Enter new password"
                                                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                                                className="absolute right-4 top-3.5 text-gray-500 hover:text-gray-300"
                                            >
                                                {showPasswords.new ? <EyeOff size={20} /> : <Eye size={20} />}
                                            </button>
                                        </div>
                                        {userPassword.newPassword && (
                                            <div className="mt-2">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-sm text-gray-400">Strength:</span>
                                                    <span className={`text-sm font-medium ${passwordStrength.label === 'Weak' ? 'text-red-400' :
                                                        passwordStrength.label === 'Medium' ? 'text-yellow-400' :
                                                            'text-green-400'
                                                        }`}>
                                                        {passwordStrength.label}
                                                    </span>
                                                </div>
                                                <div className="flex gap-1">
                                                    {[1, 2, 3, 4, 5].map((level) => (
                                                        <div
                                                            key={level}
                                                            className={`h-1.5 flex-1 rounded-full ${level <= passwordStrength.strength
                                                                ? passwordStrength.color
                                                                : 'bg-gray-700'
                                                                }`}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className="block text-gray-300 font-medium mb-2">
                                            Confirm New Password
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords.confirm ? "text" : "password"}
                                                name="confirmPassword"
                                                value={userPassword.confirmPassword}
                                                onChange={handlePasswordChange}
                                                placeholder="Confirm new password"
                                                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                                                className="absolute right-4 top-3.5 text-gray-500 hover:text-gray-300"
                                            >
                                                {showPasswords.confirm ? <EyeOff size={20} /> : <Eye size={20} />}
                                            </button>
                                        </div>
                                        {userPassword.confirmPassword && userPassword.newPassword !== userPassword.confirmPassword && (
                                            <p className="text-red-400 text-sm mt-1">Passwords don't match</p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={
                                            !userPassword.currentPassword ||
                                            !userPassword.newPassword ||
                                            !userPassword.confirmPassword ||
                                            userPassword.newPassword !== userPassword.confirmPassword
                                        }
                                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition"
                                    >
                                        Update Password
                                    </button>
                                </div>
                            </form>

                 
                        </div>
                    )}

                    <Security activeTab={activeTab} />
                </div>
            </div>
        </div>
    );
}

export default Settings;