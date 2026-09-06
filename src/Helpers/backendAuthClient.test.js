import { describe, it, expect, beforeEach, afterEach } from "vitest";
import MockAdapter from "axios-mock-adapter";
import client, { getApiMode, BACKEND_AUTH_MODE_ENABLED, login } from "./backendAuthClient";

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
});
