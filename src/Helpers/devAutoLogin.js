// Dev-only convenience while there's no real backend: skip the login screen
// and land straight in a role's dashboard on page load.
//
// - Default role is Super-Admin (broadest nav).
// - Override with a query param AT THE FRONT DOOR: http://localhost:5173/?as=admin
//   or http://localhost:5173/login?as=admin (valid: superadmin, admin,
//   teamlead, checker, user).
// - Force the real login screen back: http://localhost:5173/?as=login
//
// The `?as=` role override only takes effect on "/" or "/login" — never on
// a deep route. This file runs on EVERY full page load (any URL, including
// a plain refresh deep in the app), so a stray `?as=` left over in a
// bookmark, browser-history entry, or hand-typed URL for some other page
// must never silently swap out an already-active session's role out from
// under whoever is using it. Auto-login-when-not-logged-in-at-all is safe
// on any path, since it can only ever create a session, never hijack one.
//
// GATED ON import.meta.env.DEV (true only under `vite dev`, always false in
// a production build) — NOT on VITE_USE_MOCK_API. Mock mode is meant to run
// in production too (there's no backend live yet), and it must still show
// the real login screen there — a public/customer-facing deployment must
// never silently sign every visitor in as System Owner. Local `npm run dev`
// keeps the convenience; `npm run build` output never has it, regardless of
// which API mode that build was made with.
//
// Must run before ../redux/authSlice.js reads localStorage, so it's
// imported first thing in main.jsx.

// Also off whenever VITE_BACKEND_AUTH_MODE=true: a real backend session
// can't be faked from localStorage, and a fake "mock-jwt-token" session
// would just bounce off every real endpoint.
if (import.meta.env.DEV && import.meta.env.VITE_BACKEND_AUTH_MODE !== "true") {
  const ROLE_ALIASES = {
    superadmin: "Super-Admin",
    admin: "Admin",
    teamlead: "Team-Leader",
    checker: "Checker",
    user: "User",
  };

  const isFrontDoor = window.location.pathname === "/" || window.location.pathname === "/login";
  const roleParam = new URLSearchParams(window.location.search).get("as");

  if (isFrontDoor && roleParam?.toLowerCase() === "login") {
    localStorage.clear();
  } else {
    const matchedRole = isFrontDoor ? ROLE_ALIASES[(roleParam || "").toLowerCase()] : null;

    if (matchedRole || !localStorage.getItem("isLoggedIn")) {
      const role = matchedRole || "Super-Admin";
      localStorage.setItem("token", "mock-jwt-token");
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("role", role);
      localStorage.setItem(
        "data",
        JSON.stringify({
          _id: "mock-user-id",
          name: "Preview User",
          username: "previewuser",
          role,
        })
      );
    }
  }
}
