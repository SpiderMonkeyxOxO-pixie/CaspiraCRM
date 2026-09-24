import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ChevronDown, Settings } from "lucide-react";
import logo from "../assets/logo.png";
import UserMenu from "./User";
import { getUserData } from "../redux/authSlice";
import { useDispatch, useSelector } from "react-redux";
import { getRoleLabel } from "../utils/roleLabels";
import { BACKEND_FINANCE_MODE_ENABLED } from "../Helpers/backendFinanceClient";
import { useFinanceAccess, canDo, hasAnyFinance } from "../Helpers/financeAccess";
import { BACKEND_AI_MODE_ENABLED } from "../Helpers/backendAiClient";
import { useAiAdminAccess, visibleAiAdminPages } from "../Helpers/aiAdminAccess";
import { ShieldHalf } from "lucide-react";
import {
  FINANCE_BACKEND_CHILDREN,
  FINANCE_NAV_ICON,
  AdminRoutes,
  CheckerButtons,
  superAdminButtons,
  TeamButtons,
  UserRoutes,
} from "../Helpers/Helper";

const roleButtonsMap = {
  "Super-Admin": superAdminButtons,
  Admin: AdminRoutes,
  "Team-Leader": TeamButtons,
  User: UserRoutes,
  Checker: CheckerButtons,
};

const Menus = ({ toggle, onTitleChange }) => {
  const location = useLocation();
  const dispatch = useDispatch();
  const userData = useSelector((state) => state?.auth?.data);
  const role = useSelector((state) => state?.auth?.role);

  const wrapperRef = useRef(null);
  const userRef = useRef(null);
  const [openUser, setOpenUser] = useState(false);

  useEffect(() => {
    dispatch(getUserData());
  }, [dispatch]);

  const financeAccess = useFinanceAccess();
  let navItems = roleButtonsMap[role] ? roleButtonsMap[role]() : [];
  if (BACKEND_FINANCE_MODE_ENABLED) {
    // Finance links come from the member's Finance grants, not the login role.
    const withoutFinance = navItems.filter((item) => item.to !== "/finance/dashboard");
    const children = hasAnyFinance(financeAccess.data)
      ? FINANCE_BACKEND_CHILDREN.filter((c) => c.requires === "any" || c.requires.some(([m, a]) => canDo(financeAccess.data, m, a)))
      : [];
    const financeItem = children.length ? { to: children[0].to, label: "Finance", icon: FINANCE_NAV_ICON, children } : null;
    const at = navItems.findIndex((item) => item.to === "/finance/dashboard");
    navItems = financeItem
      ? (at >= 0 ? [...withoutFinance.slice(0, at), financeItem, ...withoutFinance.slice(at)] : [...withoutFinance.filter((i) => i.to !== "/ai/overview"), financeItem, ...withoutFinance.filter((i) => i.to === "/ai/overview")])
      : withoutFinance;
  }

  // Backend Phase 11: "AI Administration" appears only for members whose grants
  // open at least one of its pages (never for ordinary employees or portal users).
  const aiAdmin = useAiAdminAccess();
  if (BACKEND_AI_MODE_ENABLED) {
    const pages = visibleAiAdminPages(aiAdmin.data);
    if (pages.length) navItems = [...navItems, { to: pages[0].to, label: "AI Administration", icon: ShieldHalf, children: pages.map(({ to, label }) => ({ to, label })) }];
  }

  const [openSections, setOpenSections] = useState(() => new Set());
  // Match the item whose own `to` (or one of its children's `to`) is the
  // LONGEST prefix of the current pathname — never the reverse ("does this
  // item's `to` start with the current top-level segment"), which breaks as
  // soon as two nav items share a first segment (e.g. "/admin/users" for
  // Users & Access and "/admin/integrations" for Integrations both start
  // with "/admin", so a same-segment check can't tell them apart).
  const activeParentKey = useMemo(() => {
    let bestMatch = null;
    let bestLength = -1;
    navItems.forEach((item) => {
      const candidates = [item.to, ...(item.children || []).map((c) => c.to)];
      candidates.forEach((candidate) => {
        const matches = location.pathname === candidate || location.pathname.startsWith(`${candidate}/`);
        if (matches && candidate.length > bestLength) {
          bestLength = candidate.length;
          bestMatch = item.to;
        }
      });
    });
    return bestMatch;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, role]);
  useEffect(() => {
    if (activeParentKey) setOpenSections((prev) => new Set(prev).add(activeParentKey));
  }, [activeParentKey]);

  const toggleSection = (key) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getRoleStyles = (role) => {
    switch (role) {
      case "Super-Admin":
        return "bg-[#FF4D4F]/20 text-[#FF4D4F] border border-[#FF4D4F]/40"; // Red theme

      case "Admin":
        return "bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/40"; // Blue theme

      case "Checker":
        return "bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40"; // Yellow theme

      case "Team-Leader":
        return "bg-[#8B5CF6]/20 text-[#8B5CF6] border border-[#8B5CF6]/40"; // Purple theme

      case "User":
        return "bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/40"; // Green theme

      default:
        return "bg-gray-500/20 text-gray-300 border border-gray-500/40";
    }
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpenUser(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <>
      {toggle ? (
        <div className="flex flex-col justify-between h-screen px-4 overflow-hidden border-r border-white/10">
          <div className="absolute inset-0 -z-10">
            <div className="absolute -top-[0%] left-[20%] w-36 h-36 rounded-full bg-[#3B82F6] opacity-60 blur-[70px]" />
            <div className="absolute top-1/2 right-[30%] w-72 h-72 rounded-full bg-[#3B82F6] opacity-40 blur-[90px] -translate-y-1/2" />
            <div className="absolute bottom-[-5%] left-[20%] w-36 h-36 rounded-full bg-[#3B82F6] opacity-70 blur-[70px]" />
          </div>
          <div>
            <Link className="flex items-center gap-2 py-3 mt-2 px-4 border-b border-[#9E9FA74D]">
              <ArrowLeft
                className="text-white opacity-80 bg-[#3b83f61a] rounded-full"
                size={20}
              />
              <h1 className="text-white text-[14px] font-semibold">
                {`${getRoleLabel(role)} Dashboard`}

              </h1>

            </Link>

            <div className="text-white text-base mt-1 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
              {navItems.map(({ to, label, icon: Icon, children }) => {
                const hasChildren = children && children.length > 0;
                const isChildActive = hasChildren && children.some((c) => location.pathname === c.to);
                const isSectionActive = isChildActive || location.pathname === to;
                const isOpen = openSections.has(to);

                if (!hasChildren) {
                  return (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => onTitleChange(label)}
                      className={`flex items-center space-x-[12px] cursor-pointer px-[12px] py-[10px] rounded-lg transition-all duration-200
                        ${isSectionActive
                          ? "border-l-2 border-blue-500 bg-[#3b83f60e] font-medium"
                          : "text-[#778092] hover:bg-[#3b83f605] hover:border-l-2 hover:border-blue-500"
                        }`}
                    >
                      <Icon className="text-[20px]" size={20} />
                      <span className="text-[16px]">{label}</span>
                    </Link>
                  );
                }

                return (
                  <div key={to}>
                    <button
                      type="button"
                      onClick={() => toggleSection(to)}
                      aria-expanded={isOpen}
                      className={`w-full flex items-center justify-between space-x-[12px] cursor-pointer px-[12px] py-[10px] rounded-lg transition-all duration-200
                        ${isSectionActive ? "text-white font-medium" : "text-[#778092] hover:bg-[#3b83f605] hover:text-white"}`}
                    >
                      <span className="flex items-center space-x-[12px]">
                        <Icon className="text-[20px]" size={20} />
                        <span className="text-[16px]">{label}</span>
                      </span>
                      <ChevronDown
                        size={16}
                        className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="mt-1 ml-[16px] pl-[16px] border-l border-white/10 space-y-1">
                        {children.map((child) => {
                          const isActive = location.pathname === child.to;
                          return (
                            <Link
                              key={child.to}
                              to={child.to}
                              onClick={() => onTitleChange(child.label)}
                              className={`block px-[12px] py-[8px] rounded-lg text-[14px] transition-all duration-200
                                ${isActive
                                  ? "border-l-2 border-blue-500 bg-[#3b83f60e] text-white font-medium"
                                  : "text-[#778092] hover:bg-[#3b83f605] hover:border-l-2 hover:border-blue-500"
                                }`}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex-shrink-0 border-t border-gray-700 px-4 py-3">
            <div ref={userRef} className="flex items-center gap-3 mb-3">
              <img
                src={
                  userData?.avatar?.url ||
                  "https://res.cloudinary.com/du9jzqlpt/image/upload/v1674647316/avatar_drzgxv.jpg"
                }
                alt="user-avatar"
                className="h-9 w-9 rounded-full border border-gray-600 shadow-sm"
              />
              <div
                className="flex flex-col relative"
                onMouseEnter={() => setOpenUser(true)}
                onMouseLeave={() => setOpenUser(false)}
              >
                <p className="text-[16px] font-medium text-white capitalize">
                  {userData.FullName}
                </p>
                <UserMenu openUser={openUser} userData={userData} />
                <span
                  className={`text-xs capitalize rounded-md px-2 py-[1px] w-fit font-medium ${getRoleStyles(
                    role
                  )}`}
                >
                  {getRoleLabel(role)}
                </span>

              </div>
            </div>

            {toggle && (role === "Super-Admin" || role === "Admin") && (
              <Link
                to="/settings"
                className="flex px-2 items-center gap-4 font-medium text-white cursor-pointer transition-colors duration-200"
              >
                <Settings className="w-5 h-5" />
                <span className="text-sm">Settings</span>
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="py-2">
          <div className="absolute inset-0 -z-10"></div>
          <Link
            className="flex justify-center items-center mt-10 z-10"
          >
            <img
              src={logo}
              alt="communication-center"
              className="h-8 w-8 object-contain hidden dark:block"
            />
          </Link>
          {navItems.map(({ to, icon: Icon }) => (
            <div
              className="text-white relative flex items-center mt-3 cursor-pointer p-1 ml-4 z-10"
              key={to}
            >
              <Link to={to}>
                <div className="p-2 hover:bg-[#3b83f61a] text-white rounded-lg">
                  <Icon size={20} />
                </div>
              </Link>
            </div>
          ))}

          <div className="absolute bottom-4 left-6 flex justify-center items-center z-10">
            <div className="flex flex-col gap-4 relative">

              <div ref={wrapperRef} className="relative">
                <img
                  src={
                    userData?.avatar?.url ||
                    "https://res.cloudinary.com/du9jzqlpt/image/upload/v1674647316/avatar_drzgxv.jpg"
                  }
                  alt=""
                  className="rounded-lg h-9 w-9"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Menus;
