import { useEffect, useState } from "react";
import { TrendingUp, Activity, ShieldCheck } from "lucide-react";

// Small "live telemetry" pieces layered over the command-center background —
// entirely decorative/session-local (nothing here reads or writes real app
// state), meant to fill the login screen's empty space with the same
// "operational dashboard" personality as the background itself.

function useTickingValue(base, jitter, decimals = 0) {
  const [value, setValue] = useState(base);
  useEffect(() => {
    const id = setInterval(() => {
      const next = base + (Math.random() - 0.5) * jitter * 2;
      const factor = 10 ** decimals;
      setValue(Math.round(next * factor) / factor);
    }, 1800 + Math.random() * 1400);
    return () => clearInterval(id);
  }, [base, jitter, decimals]);
  return value;
}

const METRICS = [
  { label: "Deals in motion", base: 1284, jitter: 6, icon: TrendingUp },
  { label: "Active sessions", base: 214, jitter: 5, icon: Activity },
  { label: "SLA compliance", base: 98.6, jitter: 0.2, decimals: 1, suffix: "%", icon: ShieldCheck },
];

function MetricChip({ label, base, jitter, decimals, suffix = "", icon: Icon, delay }) {
  const value = useTickingValue(base, jitter, decimals);
  return (
    <div
      className="login-fade-in rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 backdrop-blur-sm"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-center gap-1.5 text-slate-500">
        <Icon className="h-3 w-3" />
        <p className="font-mono text-[10px] uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-0.5 font-mono text-base font-semibold text-emerald-300 tabular-nums">
        {value}
        {suffix}
      </p>
    </div>
  );
}

export function LiveMetricsRow({ className = "" }) {
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      {METRICS.map((m, i) => (
        <MetricChip key={m.label} {...m} delay={0.5 + i * 0.15} />
      ))}
    </div>
  );
}

const LIVE_FEED = [
  'Deal "Acme Corp — Platform Rollout" moved to Negotiation',
  "New support ticket #4821 opened — priority High",
  "Contract CN-1042 renewal window opens in 3 days",
  "Quote Q-2291 approved by finance",
  'Lead "Nimbus Retail" qualified and assigned',
  "Order #8834 marked as fulfilled",
  "SLA breach risk flagged on ticket #4790",
];

const LEGAL_ENTITY_INFO = [
  { label: "Legal Entity", value: "Caspira Solutions LLC" },
  { label: "Headquarters", value: "Yerevan, Armenia" },
  { label: "Registration Number", value: "999.110.1554400" },
  { label: "Tax Number", value: "02939828" },
  { label: "Service Regions", value: "Europe, Middle East, Asia-Pacific" },
  { label: "Core Focus", value: "Technology and Business Operations" },
];

export const SUPPORT_CONTACT_EMAIL = "caspirasolutioncontact@gmail.com";

export function LegalEntityInfo({ className = "" }) {
  return (
    <div className={`login-fade-in grid grid-cols-1 gap-2.5 sm:grid-cols-3 ${className}`}>
      {LEGAL_ENTITY_INFO.map(({ label, value }) => (
        <div key={label} className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 backdrop-blur-sm">
          <p className="font-mono text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-0.5 text-sm font-medium text-white">{value}</p>
        </div>
      ))}
    </div>
  );
}

export function OpsTicker({ className = "" }) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 overflow-hidden border-t border-white/[0.06] bg-black/40 py-1.5 backdrop-blur-sm ${className}`}>
      <div className="login-ticker flex w-max gap-10 whitespace-nowrap font-mono text-[10px] text-slate-400">
        {[...LIVE_FEED, ...LIVE_FEED].map((line, i) => (
          <span key={i} className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-emerald-400/70" />
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LoginHudStyles() {
  return (
    <style>{`
      @keyframes loginFadeInUp {
        from { opacity: 0; transform: translateY(14px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .login-fade-in { animation: loginFadeInUp .7s cubic-bezier(.16,1,.3,1) both; }

      @keyframes loginTicker { to { transform: translateX(-50%); } }
      .login-ticker { animation: loginTicker 36s linear infinite; }

      @keyframes loginGradientShift {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
      .login-gradient-text {
        background-image: linear-gradient(90deg, #60a5fa, #34d399, #60a5fa);
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: loginGradientShift 6s ease-in-out infinite;
      }

      @keyframes loginCardIn {
        from { opacity: 0; transform: translateY(24px) scale(.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .login-card-in { animation: loginCardIn .8s cubic-bezier(.16,1,.3,1) both; }

      @keyframes loginBorderGlow {
        0%, 100% { box-shadow: 0 0 0 1px rgba(96,165,250,0.15), 0 20px 60px -15px rgba(0,0,0,0.6); }
        50% { box-shadow: 0 0 0 1px rgba(96,165,250,0.35), 0 20px 70px -10px rgba(59,130,246,0.25); }
      }
      .login-card-glow { animation: loginBorderGlow 4s ease-in-out infinite; }

      .login-btn-shimmer { position: relative; overflow: hidden; }
      .login-btn-shimmer::after {
        content: "";
        position: absolute;
        top: 0; left: -60%;
        width: 40%; height: 100%;
        background: linear-gradient(120deg, transparent, rgba(255,255,255,0.4), transparent);
        transform: skewX(-20deg) translateX(0);
        opacity: 0;
      }
      @keyframes loginShimmer {
        0% { transform: skewX(-20deg) translateX(0); opacity: 1; }
        100% { transform: skewX(-20deg) translateX(420%); opacity: 0; }
      }
      .login-btn-shimmer:hover::after { animation: loginShimmer .85s ease forwards; }

      @media (prefers-reduced-motion: reduce) {
        .login-fade-in, .login-ticker, .login-gradient-text, .login-card-in, .login-card-glow, .login-btn-shimmer::after {
          animation: none !important;
        }
      }
    `}</style>
  );
}
