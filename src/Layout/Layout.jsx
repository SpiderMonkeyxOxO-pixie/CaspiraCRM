import { useEffect, useRef, useState } from "react";
import { Ban, CaseSensitive, ChevronsLeft, ChevronsRight, LogOut, Moon, Sun, User } from "lucide-react";
import { Outlet, useNavigate } from "react-router-dom";
import Menus from "../Menus/SubMenus";
import NotificationPopup from "../components/popup/Notification";
import { useDispatch, useSelector } from "react-redux";
import BindGoogleModal from "./BIndGoogle";
import { logout } from "../redux/authSlice";
import ProfileModal from "../components/popup/ProfileModal";
import { useTextSize } from "../Context/TextContext";
import { useTheme } from "../Context/ThemeContext";

const Layout = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate()
    const menuRef = useRef(null);
    const [toggle, setToggle] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const [dateTime, setDateTime] = useState("");
    const [pageTitle, setPageTitle] = useState("Dashboard");
    const userData = useSelector((state) => state?.auth?.data);
    const [isBindModalOpen, setBindModalOpen] = useState(false);
    const [open, setOpen] = useState(false);
    const { textSize, setTextSize } = useTextSize();
    const { theme, toggleTheme } = useTheme();
    const [showTextSizeSlider, setShowTextSizeSlider] = useState(false);
    const handleToggle = () => {
        setToggle(!toggle);
    };
    const getPhilippinesDateTime = () => {
        const now = new Date();

        const date = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Manila",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        }).format(now);

        const time = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        }).format(now);

        return `${date} - ${time}`;
    };


    useEffect(() => {
        const update = () => {
            setDateTime(getPhilippinesDateTime());
        };

        update(); // initial call
        const interval = setInterval(update, 1000);

        return () => clearInterval(interval);
    }, []);


    const handleBindGoogleClick = () => {
        if (userData?.qrCode) {
            setBindModalOpen(true);
        } else {
            alert("QR code not found. Contact admin.");
        }
    };

    useEffect(() => {
        const onClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);
    const handleLogout = async (event) => {
        event.preventDefault();
        const res = await dispatch(logout());
        if (res?.payload?.success) navigate("/");
    }

    const sidebarWidth = toggle ? 300 : 80;

    return (
        <>
            <div className="relative w-screen h-screen overflow-hidden text-white bg-[#00010B]">
                <div
                    className="fixed top-0 left-0 h-full transition-all duration-300 z-10 flex flex-col bg-[#00010B]"
                    style={{ width: `${sidebarWidth}px` }}
                >
                    <div className="absolute top-2 right-2 cursor-pointer text-white transition z-20">
                        {toggle ? (
                            <ChevronsLeft size={22} onClick={handleToggle} />
                        ) : (
                            <ChevronsRight size={22} onClick={handleToggle} />
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto overflow-x-hidden hide-scrollbar">
                        <Menus toggle={toggle} onTitleChange={setPageTitle} />
                    </div>
                </div>

                <div
                    className="flex flex-col h-full transition-all duration-300"
                    style={{
                        marginLeft: `${sidebarWidth}px`,
                        width: `calc(100% - ${sidebarWidth}px)`,
                    }}
                >
                    <div className="h-[60px] flex items-center justify-between px-4 border-b border-gray-700 shrink-0 sticky top-0 z-10 bg-[#00010B]">

                        <h1 className="text-lg font-semibold truncate">{pageTitle}</h1>

                        <div className="flex items-center gap-4 absolute right-0">
                            <div className="text-sm text-gray-400 space-y-1 whitespace-nowrap">
                                <div>{dateTime}</div>

                            </div>

                            <button
                                onClick={toggleTheme}
                                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-[#282e3c61] cursor-pointer"
                            >
                                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                            </button>

                            <NotificationPopup userId={userData?._id} />
                            <div className="flex items-center gap-3" ref={menuRef}>
                                <button
                                    onClick={() => setIsOpen((o) => !o)}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-[#282e3c61] cursor-pointer"
                                >
                                    <User size={20} />
                                </button>

                                {isOpen && (
                                    <div className="absolute right-0 top-[60px] animate-fadeIn w-40 border bg-[#111113]/95 backdrop-blur-3xl border-[#2e3135] text-white rounded-xl shadow-xl z-50">
                                        <div
                                            onClick={() => setOpen(true)}
                                            onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
                                            tabIndex={0}
                                            className="flex items-center gap-2 px-4 py-2 hover:bg-[#2e303759] cursor-pointer"
                                        >
                                            <User /> {("Profile")}
                                        </div>
                                        <div
                                            onClick={() => setShowTextSizeSlider(!showTextSizeSlider)}
                                            className="cursor-pointer flex items-center gap-3 px-4 py-3 text-white transition-colors"
                                        >
                                            <CaseSensitive size={18} />
                                            <span className="text-sm font-medium">Text Size</span>
                                        </div>
                                        <div
                                            onClick={handleBindGoogleClick}
                                            className="flex items-center gap-2 px-4 py-2 hover:bg-[#2e303759] cursor-pointer"
                                        >
                                            <Ban size={20} /> Bind Google
                                        </div>
                                        <div
                                            onClick={(e) => handleLogout(e)}
                                            className="flex items-center gap-2 px-4 py-2 hover:bg-[#2e303759] cursor-pointer"
                                        >
                                            <LogOut size={20} />
                                            Logout
                                        </div>

                                        {showTextSizeSlider && (
                                            <div className="absolute cursor-pointer -left-5 mt-1 w-44 p-2 bg-[#1f212b] rounded-lg shadow-lg z-50">
                                                <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                                                    <span>12px</span>
                                                    <span>{textSize}px</span>
                                                    <span>48px</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="12"
                                                    max="48"
                                                    value={textSize}
                                                    onChange={(e) => setTextSize(parseInt(e.target.value))}
                                                    className="w-full accent-blue-500 cursor-pointer"
                                                />
                                            </div>
                                        )}

                                    </div>
                                )}
                                <ProfileModal
                                    isOpen={open}
                                    onClose={() => setOpen(false)}
                                    user={userData}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto px-1 min-h-0">
                        <Outlet />
                    </div>
                </div>

                <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                    <div className="absolute top-2/3 left-[40%] w-[600px] h-[600px] rounded-full bg-[#3B82F6] opacity-20 blur-[200px] transform -translate-x-1/2 -translate-y-1/2"></div>
                    <div className="absolute -top-[10%] -right-[5%] w-96 h-96 rounded-full bg-[#3B82F6] opacity-20 blur-[110px]"></div>
                    <div className="absolute -bottom-[5%] -right-[5%] w-96 h-96 rounded-full bg-[#3B82F6] opacity-20 blur-[100px]"></div>
                </div>
            </div>
            <BindGoogleModal
                isOpen={isBindModalOpen}
                onClose={() => setBindModalOpen(false)}
                qrCodeUrl={userData?.qrCode}
            />
        </>
    );
};

export default Layout;
