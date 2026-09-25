import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { addFcm, login, verify2FA } from "../redux/authSlice";
import toast from "react-hot-toast";
import { requestForToken } from "../services/firebase/firebase";
import { getHomePathForRole } from "../utils/roleRoutes";
import { BACKEND_AUTH_MODE_ENABLED } from "../Helpers/backendAuthClient";
import { LiveMetricsRow, OpsTicker, LoginHudStyles, LegalEntityInfo, SUPPORT_CONTACT_EMAIL } from "./LoginHud";
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  AlertCircle,
  ArrowLeft,
  Building2,
  Workflow,
  LineChart,
} from "lucide-react";

const FEATURES = [
  { icon: Building2, text: "Unified CRM across Sales, Support, Projects & Finance" },
  { icon: Workflow, text: "Role-based access tailored to every team" },
  { icon: ShieldCheck, text: "Secured with two-factor authentication" },
  { icon: LineChart, text: "Real-time pipeline & performance visibility" },
];

const Login = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // The sign-in page always sits on the dark command-center background, so it
  // renders in the dark theme even when the user's saved preference is light
  // (the light theme turns text-white dark). The saved theme returns on leave.
  // The theme provider applies the saved theme after this page mounts, so the
  // page keeps dark applied while it's open and restores the saved one after.
  useEffect(() => {
    const root = document.documentElement;
    const hold = () => { if (root.getAttribute("data-theme") !== "dark") root.setAttribute("data-theme", "dark"); };
    hold();
    const observer = new MutationObserver(hold);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      let saved = null;
      try { saved = localStorage.getItem("crm.theme"); } catch { /* storage unavailable */ }
      root.setAttribute("data-theme", saved === "light" ? "light" : "dark");
    };
  }, []);

  const passwordRef = useRef(null);
  const otpRefs = useRef([]);

  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [requireOtp, setRequireOtp] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const otp = otpDigits.join("");
  const { error } = useSelector((state) => state.auth);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setLoginData((prev) => ({ ...prev, [name]: value }));
  };

  const handleOtpDigitChange = (index, value) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    pasted.split("").forEach((ch, i) => { next[i] = ch; });
    setOtpDigits(next);
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const validate = () => {
    const newErrors = {};
    if (!requireOtp) {
      if (!loginData.username) newErrors.username = "Username is required";
      if (!loginData.password) newErrors.password = "Password is required";
    } else {
      if (otp.length < 6) newErrors.otp = "Enter the full 6-digit code";
    }
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      if (!requireOtp) {
        const res = await dispatch(login(loginData));
        const payload = res?.payload;

        if (!payload) {
          setIsLoading(false);
          return;
        }

        if (payload?.require2FA) {
          setRequireOtp(true);
        } else if ((payload?.token || payload?.user) && !payload?.require2FA) {
          // Backend-auth mode returns no token (httpOnly cookie session),
          // only the user — either one means the login succeeded.
          toast.success("Login successful!");

          const homePath = getHomePathForRole(payload?.user?.role);
          if (homePath) {
            navigate(homePath);
          } else {
            navigate("/login");
            toast.error("Invalid role detected");
          }

          requestForToken()
            .then((fcmToken) => {
              if (fcmToken) {
                dispatch(addFcm(fcmToken));
              } else {
                console.warn("⚠️ No FCM token available.");
              }
            })
            .catch((err) => console.error("FCM Error:", err));

        } else {
          console.log("Invalid response from server");
        }

      } else {
        // Backend-auth mode: the session login takes the code with the same
        // credentials (Backend Phase 13); the legacy flow verifies separately.
        const res = BACKEND_AUTH_MODE_ENABLED ? await dispatch(login({ ...loginData, otp })) : await dispatch(verify2FA({ otp }));
        const payload = res?.payload;
        if (BACKEND_AUTH_MODE_ENABLED && res?.error) toast.error(typeof payload === "string" ? payload : "That verification code is not correct.");

        if (payload?.token || (BACKEND_AUTH_MODE_ENABLED && payload?.user?.role && !payload?.require2FA)) {
          toast.success("Login successful!");

          const homePath = getHomePathForRole(payload?.user?.role);
          if (homePath) {
            navigate(homePath);
          } else {
            navigate("/login");
            toast.error("Invalid role detected");
          }

          requestForToken()
            .then((fcmToken) => {
              if (fcmToken) dispatch(addFcm(fcmToken));
            })
            .catch((err) => console.error("FCM Error:", err));
        } else {
          console.error("Invalid OTP");
        }
      }
    } catch {
      console.error("Something went wrong");
    }

    setIsLoading(false);
  };

  const handleBack = () => {
    setRequireOtp(false);
    setOtpDigits(["", "", "", "", "", ""]);
    setErrors({});
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05070d] text-white">
      <LoginHudStyles />

      {/* Real animated command-center background (photo layer, particle
          field and a WebGL globe) — a self-contained static page, embedded
          exactly as authored rather than hand-ported into React, so its
          WebGL shader math and animation timing can't drift from the
          original. Content below sits on top per its own documented
          integration contract (fixed background, relative+z-index content). */}
      <iframe
        src="/backgrounds/command-center-background.html"
        title=""
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 h-full w-full border-0"
      />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-2">
        {/* Branding panel — translucent so the command-center background
            shows through; the gradient only exists for text legibility. */}
        <div className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-white/5 bg-gradient-to-r from-[#05070d]/80 via-[#05070d]/45 to-transparent p-14 xl:p-20">
          <div className="login-fade-in relative z-10 flex items-center gap-3">
            <span className="text-lg font-semibold tracking-tight">Caspira CRM</span>
          </div>

          <div className="relative z-10 max-w-lg">
            <h2 className="login-fade-in text-4xl font-bold leading-[1.1] text-white xl:text-5xl" style={{ animationDelay: "0.1s" }}>
              Run your whole business from one <span className="login-gradient-text">command center</span>.
            </h2>
            <p className="login-fade-in mt-4 text-base text-slate-400" style={{ animationDelay: "0.2s" }}>
              CRM, Sales, Support, Projects, Marketing and Finance — one workspace, built for every role on your team.
            </p>

            <ul className="mt-9 space-y-4">
              {FEATURES.map(({ icon: Icon, text }, i) => (
                <li
                  key={text}
                  className="login-fade-in flex items-start gap-3 transition-transform duration-300 hover:translate-x-1.5"
                  style={{ animationDelay: `${0.3 + i * 0.1}s` }}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-blue-400">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="pt-1.5 text-sm text-slate-300">{text}</span>
                </li>
              ))}
            </ul>

            <LiveMetricsRow className="mt-10" />
          </div>

          <div className="relative z-10 space-y-3">
            <LegalEntityInfo />
            <p className="login-fade-in text-xs text-slate-500" style={{ animationDelay: "0.9s" }}>
              © {new Date().getFullYear()} Caspira CRM. All rights reserved. · Contact:{" "}
              <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="text-slate-400 underline-offset-2 hover:text-slate-300 hover:underline">
                {SUPPORT_CONTACT_EMAIL}
              </a>
            </p>
          </div>
        </div>

        {/* Form panel */}
        <div className="relative flex items-center justify-center p-6 sm:p-10">
          <div className="login-card-in w-full max-w-md" style={{ animationDelay: "0.15s" }}>
            <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
              <span className="text-base font-semibold tracking-tight">Caspira CRM</span>
            </div>

            <form
              onSubmit={handleSubmit}
              className="login-card-glow rounded-2xl border border-white/10 bg-white/[0.05] p-9 backdrop-blur-xl transition-all duration-500"
            >
              {!requireOtp ? (
                <>
                  <div className="mb-1 flex items-center gap-1.5 text-emerald-400/80">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-widest">Secure connection</span>
                  </div>
                  <h1 className="text-3xl font-bold text-white">Welcome back</h1>
                  <p className="mt-1 text-sm text-slate-400">Sign in to continue to your dashboard.</p>

                  {error && (
                    <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="mt-6 flex flex-col gap-4">
                    <div>
                      <label className="mb-1.5 block text-sm text-slate-300">Username</label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          name="username"
                          placeholder="Enter your username"
                          autoComplete="username"
                          className={`w-full rounded-lg border bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 outline-none transition-colors transition-shadow focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:shadow-[0_0_16px_rgba(59,130,246,0.25)] ${
                            errors.username ? "border-red-500/60" : "border-white/10"
                          }`}
                          value={loginData.username}
                          onChange={handleInputChange}
                        />
                      </div>
                      {errors.username && (
                        <span className="mt-1.5 flex items-center gap-1 text-xs text-red-400">
                          <AlertCircle className="h-3 w-3" /> {errors.username}
                        </span>
                      )}
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm text-slate-300">Password</label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                          type={showPassword ? "text" : "password"}
                          name="password"
                          placeholder="Enter your password"
                          autoComplete="current-password"
                          className={`w-full rounded-lg border bg-white/5 py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-slate-500 outline-none transition-colors transition-shadow focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:shadow-[0_0_16px_rgba(59,130,246,0.25)] ${
                            errors.password ? "border-red-500/60" : "border-white/10"
                          }`}
                          ref={passwordRef}
                          value={loginData.password}
                          onChange={handleInputChange}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {errors.password && (
                        <span className="mt-1.5 flex items-center gap-1 text-xs text-red-400">
                          <AlertCircle className="h-3 w-3" /> {errors.password}
                        </span>
                      )}
                    </div>

                    <button
                      type="submit"
                      className="login-btn-shimmer mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-3 text-sm font-medium text-white transition-all duration-300 hover:from-blue-500 hover:to-blue-400 hover:shadow-[0_0_24px_rgba(59,130,246,0.5)] focus:outline-none focus:ring-4 focus:ring-blue-500/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Signing in...
                        </>
                      ) : (
                        "Sign in"
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <h1 className="mt-3 text-2xl font-bold text-white">Two-Factor Verification</h1>
                    <p className="mt-1 text-sm text-slate-400">
                      Enter the 6-digit code from your authenticator app.
                    </p>
                  </div>

                  <div className="mt-6 flex flex-col gap-4">
                    <div className="flex justify-between gap-2" onPaste={handleOtpPaste}>
                      {otpDigits.map((digit, index) => (
                        <input
                          key={index}
                          ref={(el) => (otpRefs.current[index] = el)}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpDigitChange(index, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(index, e)}
                          className={`h-12 w-11 rounded-lg border bg-white/5 text-center text-lg font-semibold text-white outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                            errors.otp ? "border-red-500/60" : "border-white/10"
                          }`}
                        />
                      ))}
                    </div>
                    {errors.otp && (
                      <span className="flex items-center justify-center gap-1 text-xs text-red-400">
                        <AlertCircle className="h-3 w-3" /> {errors.otp}
                      </span>
                    )}

                    <button
                      type="submit"
                      className="login-btn-shimmer mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-3 text-sm font-medium text-white transition-all duration-300 hover:from-blue-500 hover:to-blue-400 hover:shadow-[0_0_24px_rgba(59,130,246,0.5)] focus:outline-none focus:ring-4 focus:ring-blue-500/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Verifying...
                        </>
                      ) : (
                        "Verify & continue"
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleBack}
                      className="flex items-center justify-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back to login
                    </button>
                  </div>
                </>
              )}
            </form>

            <p className="mt-6 rounded-lg bg-black/30 px-3 py-1.5 text-center text-xs text-slate-400 backdrop-blur-sm">
              Trouble signing in? Contact your workspace administrator or{" "}
              <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="text-slate-300 underline-offset-2 hover:underline">
                {SUPPORT_CONTACT_EMAIL}
              </a>
              .
            </p>
          </div>
        </div>
      </div>

      <OpsTicker className="hidden lg:block" />
    </div>
  );
};

export default Login;
