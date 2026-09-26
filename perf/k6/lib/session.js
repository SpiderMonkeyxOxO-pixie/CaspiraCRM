// One signed-in synthetic user per virtual user (VU), using the real
// cookie session: login once, reuse the cookies, refresh on 401, and echo
// the csrm_csrf cookie on every write like the browser does.
import http from "k6/http";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

export const unauthorizedResponses = new Counter("unauthorized_responses");
export const loginFailures = new Counter("login_failures");

let session = null;

// Spread VUs over the manifest so large organizations get more concurrent
// users, the same way their share of members is larger.
export function userForVu(users) {
  return users[(exec.vu.idInTest - 1) % users.length];
}

function csrf(baseUrl) {
  const jar = http.cookieJar().cookiesForURL(baseUrl);
  return (jar.csrm_csrf && jar.csrm_csrf[0]) || "";
}

export function signIn(baseUrl, user) {
  const res = http.post(`${baseUrl}/auth/login`, JSON.stringify({ username: user.username, password: __ENV.PERF_USER_PASSWORD }), {
    headers: { "Content-Type": "application/json" }, tags: { group: "auth", name: "auth.login" },
  });
  if (res.status !== 200) {
    loginFailures.add(1);
    return null;
  }
  session = { baseUrl, user, orgId: user.organizationId };
  return session;
}

export function currentSession(baseUrl, users) {
  if (session) return session;
  return signIn(baseUrl, userForVu(users));
}

// A request as the signed-in user. `expectAllowed` marks journeys the role is
// entitled to: a 401/403 there counts as an authorization failure under load.
export function call(method, path, { body = null, group, name, expectAllowed = true, params = {} } = {}) {
  const url = `${session.baseUrl}${path}`;
  const headers = { "Content-Type": "application/json", "X-Organization-Id": session.orgId, "X-Correlation-Id": `k6-${exec.vu.idInTest}-${exec.vu.iterationInScenario}` };
  if (method !== "GET") headers["X-CSRF-Token"] = csrf(session.baseUrl);
  const opts = { headers, tags: { group, name }, ...params };
  let res = http.request(method, url, body === null ? null : JSON.stringify(body), opts);
  if (res.status === 401) {
    // Access token expired: refresh once, like the app does.
    const refreshed = http.post(`${session.baseUrl}/auth/refresh`, null, { headers: { "X-CSRF-Token": csrf(session.baseUrl) }, tags: { group: "auth", name: "auth.refresh" } });
    if (refreshed.status === 200) {
      headers["X-CSRF-Token"] = csrf(session.baseUrl);
      res = http.request(method, url, body === null ? null : JSON.stringify(body), opts);
    }
  }
  if (expectAllowed && (res.status === 401 || res.status === 403)) unauthorizedResponses.add(1, { name });
  return res;
}

export function json(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}
