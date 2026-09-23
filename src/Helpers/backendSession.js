// The organization every backend-mode /crm/* and /sales/* request is scoped
// to. Chosen once at login (the user's first organization) and kept in
// localStorage alongside the rest of the session's display data — it's an
// identifier, not a credential: the server re-checks a live membership on
// every request regardless of what the client sends.
const KEY = "activeOrganizationId";

export function getActiveOrganizationId() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveOrganizationId(organizationId) {
  try {
    if (organizationId) localStorage.setItem(KEY, organizationId);
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable — callers fall back to re-resolving at next login
  }
}
