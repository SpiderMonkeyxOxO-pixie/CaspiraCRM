import { describe, it, expect, vi } from "vitest";
import { requireCsrf } from "./csrf.js";
import { CSRF_COOKIE } from "../utils/cookies.js";

function mockReq({ method = "POST", cookies = {}, headers = {} } = {}) {
  return { method, cookies, headers };
}
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("requireCsrf", () => {
  it("passes through safe methods without checking anything", () => {
    const next = vi.fn();
    requireCsrf(mockReq({ method: "GET" }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a mutation with no CSRF cookie or header", () => {
    const res = mockRes();
    const next = vi.fn();
    requireCsrf(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects a mutation where the header doesn't match the cookie", () => {
    const res = mockRes();
    const next = vi.fn();
    requireCsrf(mockReq({ cookies: { [CSRF_COOKIE]: "abc" }, headers: { "x-csrf-token": "different" } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("accepts a mutation where the header matches the cookie", () => {
    const next = vi.fn();
    requireCsrf(mockReq({ cookies: { [CSRF_COOKIE]: "abc" }, headers: { "x-csrf-token": "abc" } }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
