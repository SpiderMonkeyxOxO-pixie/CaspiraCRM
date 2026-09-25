import React, { useState } from "react";
import { FcGoogle } from "react-icons/fc";
import toast from "react-hot-toast";
import { IoClose } from "react-icons/io5";
import axiosInstance from "../Helpers/axiosInstance";

const BindGoogleModal = ({ isOpen, onClose, qrCodeUrl }) => {
    const [authCode, setAuthCode] = useState("");

    if (!isOpen) return null;
    const handleSubmit = async () => {
        if (!authCode) {
            toast.error("Please enter the code");
            return;
        }
    
        try {
            const jwtToken = localStorage.getItem('token'); 
    
            const response = await axiosInstance.post(
                "user/verify-2fa",
                { otp: authCode },
                {
                    headers: {
                        Authorization: `Bearer ${jwtToken}`,
                    },
                }
            );
    
            if (response.data.success) {
                toast.success("Google Authenticator verified successfully!");
                localStorage.setItem('token', response.data.token);
                onClose();
            } else {
                toast.error("Invalid verification code");
            }
        } catch {
            toast.error("Something went wrong. Try again.");
        }
    };
    
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center">
            <div className=" w-[480px] max-w-full rounded-2xl shadow-2xl border border-[var(--box-border)] bg-[#3b83f60e] p-6 z-10 text-gray-200" >
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold">Bind Google</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <IoClose size={20} />
                    </button>
                </div>

                <div className="flex justify-center mb-6">
                    <div className="p-2 border border-gray-500 rounded-xl bg-black/10">
                        <img
                            src={qrCodeUrl}
                            alt="Google Authenticator QR"
                            className="w-40 h-40 rounded-md"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2 border border-gray-300 rounded p-2 mb-4">
                    <FcGoogle size={20} />
                    <input
                        type="text"
                        value={authCode}
                        onChange={(e) => setAuthCode(e.target.value)}
                        placeholder="Enter your Google code"
                        className="outline-none w-full text-sm outline-white"
                    />
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        className="px-6 py-2 border hover:bg-white hover:text-black text-white rounded-lg transition-colors duration-200 font-medium shadow-sm"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="bg-sky-400 text-white px-4 py-1 rounded hover:bg-sky-500"
                        onClick={handleSubmit}
                    >
                        Okay
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BindGoogleModal;