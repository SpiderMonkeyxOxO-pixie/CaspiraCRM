import { describe, it, expect, beforeEach, afterEach } from "vitest";
import MockAdapter from "axios-mock-adapter";
import client, { getApiMode, BACKEND_AUTH_MODE_ENABLED, login, loginWithIdentifier } from "./backendAuthClient";

describe("backendAuthClient", () => {
  let mock;
  beforeEach(() => {
    mock = new MockAdapter(client);
    document.cookie = "csrm_csrf=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  });
  afterEach(() => mock.restore());

  it("is not wired into the mock/backend CRM toggle — a separate, explicit flag", () => {
    expect(typeof BACKEND_AUTH_MODE_ENABLED).toBe("boolean");
    const mode = getApiMode();
    expect(mode).toHaveProperty("crmDataSource");
    expect(mode).toHaveProperty("authSource");
  });

  it("never attaches a CSRF header to a GET request", async () => {
    mock.onGet("/auth/me").reply((config) => {
      expect(config.headers["X-CSRF-Token"]).toBeUndefined();
      return [200, { user: { _id: "u1" } }];
    });
    document.cookie = "csrm_csrf=some-csrf-value; path=/;";
    await client.get("/auth/me");
  });

  it("attaches the CSRF cookie value as a header on a mutating request", async () => {
    document.cookie = "csrm_csrf=some-csrf-value; path=/;";
    mock.onPost("/auth/logout").reply((config) => {
      expect(config.headers["X-CSRF-Token"]).toBe("some-csrf-value");
      return [200, { message: "Logged out" }];
    });
    await client.post("/auth/logout");
  });

  it("sends withCredentials so httpOnly session cookies are included", () => {
    expect(client.defaults.withCredentials).toBe(true);
  });

  it("login() posts to /auth/login with email and password and returns the response body", async () => {
    mock.onPost("/auth/login").reply(200, { user: { _id: "u1", email: "a@b.com" } });
    const result = await login("a@b.com", "pw");
    expect(result.user.email).toBe("a@b.com");
  });

  it("never stores a token in localStorage on login", async () => {
    mock.onPost("/auth/login").reply(200, { user: { _id: "u1" } });
    await login("a@b.com", "pw");
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("sends the authenticator code with the credentials when two-factor is required (Phase 13)", async () => {
    const bodies = [];
    mock.onPost("/auth/login").reply((config) => { const b = JSON.parse(config.data); bodies.push(b); return b.otp ? [200, { user: { _id: "u1" } }] : [401, { code: "MFA_REQUIRED" }]; });
    await expect(loginWithIdentifier("owner", "pw")).rejects.toMatchObject({ response: { data: { code: "MFA_REQUIRED" } } });
    await loginWithIdentifier("owner", "pw", "123456");
    expect(bodies).toEqual([{ username: "owner", password: "pw" }, { username: "owner", password: "pw", otp: "123456" }]);
  });
});
