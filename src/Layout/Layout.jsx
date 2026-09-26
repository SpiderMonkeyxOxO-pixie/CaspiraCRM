import { useEffect, useRef, useState } from "react";
import { CaseSensitive, ChevronsLeft, ChevronsRight, LogOut, Moon, Settings as SettingsIcon, ShieldCheck, Sun, User } from "lucide-react";
import { Outlet, useNavigate } from "react-router-dom";
import Menus from "../Menus/SubMenus";
import NotificationPopup from "../components/popup/Notification";
import { useDispatch, useSelector } from "react-redux";
import { logout } from "../redux/authSlice";
import ProfileModal from "../components/popup/ProfileModal";
import { TEXT_SIZES, useTextSize } from "../Context/TextContext";
import { useTheme } from "../Context/ThemeContext";
import { GuideProvider } from "../guide/GuideContext";
import HelpButton from "../guide/HelpButton";
import HelpPanel from "../guide/HelpPanel";
import Tour from "../guide/Tour";
import TourPrompt from "../guide/TourPrompt";

// The viewer's own time zone, e.g. "26/09/2026 10:22:46 AM · Yerevan".
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const ZONE_LABEL = TIME_ZONE.split("/").pop().replace(/_/g, " ");
const formatNow = (now) =>
    `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(now)} - ${new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(now)} · ${ZONE_LABEL}`;

const Layout = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate()
    const menuRef = useRef(null);
    const [toggle, setToggle] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const [dateTime, setDateTime] = useState("");
    const [pageTitle, setPageTitle] = useState("Dashboard");
    const userData = useSelector((state) => state?.auth?.data);
    const [open, setOpen] = useState(false);
    const { textSize, setTextSize } = useTextSize();
    const { theme, toggleTheme } = useTheme();
    const [showTextSizes, setShowTextSizes] = useState(false);
    const handleToggle = () => {
        setToggle(!toggle);
    };

    useEffect(() => {
        const update = () => setDateTime(formatNow(new Date()));
        update(); // initial call
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, []);

    const goTo = (path) => { setIsOpen(false); navigate(path); };

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
        if (logout.fulfilled.match(res)) navigate("/");
    }

    const sidebarWidth = toggle ? 300 : 80;

    return (
        <GuideProvider>
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

                            <HelpButton />

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
                                    <div role="menu" className="absolute right-2 top-[60px] animate-fadeIn w-60 border border-gray-700 bg-gray-900 text-white rounded-xl shadow-xl z-50 py-1 text-sm">
                                        <button type="button" role="menuitem" onClick={() => { setIsOpen(false); setOpen(true); }}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 text-left">
                                            <User size={18} /> Profile
                                        </button>
                                        <button type="button" role="menuitem" aria-expanded={showTextSizes} onClick={() => setShowTextSizes((v) => !v)}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 text-left">
                                            <CaseSensitive size={18} /> Text size
                                            <span className="ml-auto text-xs text-gray-400">{TEXT_SIZES.find((s) => s.id === textSize)?.label}</span>
                                        </button>
                                        {showTextSizes && (
                                            <div className="px-4 pb-2 grid grid-cols-2 gap-1.5" role="group" aria-label="Text size">
                                                {TEXT_SIZES.map((s) => (
                                                    <button key={s.id} type="button" onClick={() => setTextSize(s.id)} aria-pressed={textSize === s.id}
                                                        className={`rounded-md border px-2 py-1.5 text-xs ${textSize === s.id ? "border-blue-500/30 bg-blue-500/10 text-blue-300 font-semibold" : "border-gray-700 text-gray-300 hover:bg-gray-800"}`}>
                                                        {s.label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <button type="button" role="menuitem" onClick={() => goTo("/settings?tab=security")}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 text-left">
                                            <ShieldCheck size={18} /> Two-factor authentication
                                            <span className={`ml-auto text-[10px] rounded px-1.5 py-0.5 border ${userData?.twoFactorEnabled ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-gray-500/15 text-gray-400 border-gray-500/30"}`}>
                                                {userData?.twoFactorEnabled ? "On" : "Off"}
                                            </span>
                                        </button>
                                        <button type="button" role="menuitem" onClick={() => goTo("/settings")}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 text-left">
                                            <SettingsIcon size={18} /> Settings
                                        </button>
                                        <div className="border-t border-gray-700 my-1" />
                                        <button type="button" role="menuitem" onClick={(e) => handleLogout(e)}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 text-left text-red-400">
                                            <LogOut size={18} /> Sign out
                                        </button>
                                    </div>
                                )}
                                <ProfileModal
                                    isOpen={open}
                                    onClose={() => setOpen(false)}
                                    onEdit={() => { setOpen(false); navigate("/settings"); }}
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
            <HelpPanel />
            <Tour />
            <TourPrompt />
        </GuideProvider>
    );
};

export default Layout;
