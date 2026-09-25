import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { securityHeaders, requireJsonBody, requestTimeout, trustProxySetting, allowedOrigins, legacyUserApiEnabled } from "./security.js";
import { correlationId } from "./correlationId.js";
import { errorHandler } from "./errorHandler.js";

// Backend Phase 13 — HTTP hardening shared by every route.
function app(extra = () => {}) {
  const a = express();
  a.use(correlationId);
  a.use(securityHeaders);
  a.use(requireJsonBody);
  a.use(express.json({ limit: "1kb" }));
  extra(a);
  a.post("/api/v1/echo", (req, res) => res.json({ ok: true }));
  a.get("/api/v1/boom", () => { throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 at /app/src/db.js"), { status: 500 }); });
  a.get("/api/v1/prisma", () => { const e = new Error("Invalid `prisma.user.findMany()` invocation: password = 'x'"); e.name = "PrismaClientValidationError"; throw e; });
  a.get("/api/v1/forbidden", () => { throw Object.assign(new Error("Not allowed here."), { status: 403, code: "FORBIDDEN" }); });
  a.use(errorHandler);
  return a;
}

describe("security headers", () => {
  it("sets defensive headers and no-store on API responses", async () => {
    const r = await request(app()).post("/api/v1/echo").send({ a: 1 });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["strict-transport-security"]).toBeUndefined();
  });
  it("adds HSTS only when enabled", async () => {
    process.env.HSTS_ENABLED = "true";
    const r = await request(app()).post("/api/v1/echo").send({});
    delete process.env.HSTS_ENABLED;
    expect(r.headers["strict-transport-security"]).toMatch(/max-age=\d+; includeSubDomains/);
  });
});

describe("request bodies", () => {
  it("refuses non-JSON bodies with 415", async () => {
    const r = await request(app()).post("/api/v1/echo").set("Content-Type", "text/plain").send("a=1");
    expect(r.status).toBe(415);
    expect(r.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });
  it("returns safe envelopes for oversized and malformed JSON", async () => {
    const big = await request(app()).post("/api/v1/echo").set("Content-Type", "application/json").send(JSON.stringify({ x: "y".repeat(5000) }));
    expect(big.status).toBe(413);
    expect(big.body.code).toBe("PAYLOAD_TOO_LARGE");
    const bad = await request(app()).post("/api/v1/echo").set("Content-Type", "application/json").send("{nope");
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_JSON");
  });
});

describe("error envelope", () => {
  it("never leaks internal details on server errors", async () => {
    for (const p of ["/api/v1/boom", "/api/v1/prisma"]) {
      const r = await request(app()).get(p);
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ code: "INTERNAL_ERROR", message: "Something went wrong", correlationId: r.headers["x-correlation-id"] });
      expect(JSON.stringify(r.body)).not.toMatch(/10\.0\.0\.5|\/app\/src|prisma|password/);
    }
  });
  it("keeps intentional client errors with their code", async () => {
    const r = await request(app()).get("/api/v1/forbidden");
    expect(r.body).toMatchObject({ code: "FORBIDDEN", message: "Not allowed here." });
  });
});

describe("correlation ids", () => {
  it("accepts a safe caller id and replaces an unsafe one", async () => {
    const ok = await request(app()).post("/api/v1/echo").set("X-Request-Id", "proxy-req-12345678").send({});
    expect(ok.headers["x-correlation-id"]).toBe("proxy-req-12345678");
    const evil = await request(app()).post("/api/v1/echo").set("X-Correlation-Id", "abc\" injected=1 <script>").send({});
    expect(evil.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("timeouts, proxies, origins and legacy API", () => {
  it("ends slow handlers with 503 but leaves event streams alone", async () => {
    const a = app((x) => {
      x.use(requestTimeout(50));
      x.get("/api/v1/slow", () => {});
      x.get("/api/v1/x/events", (req, res) => setTimeout(() => res.json({ streamed: true }), 100));
    });
    const slow = await request(a).get("/api/v1/slow");
    expect(slow.status).toBe(503);
    expect(slow.body.code).toBe("REQUEST_TIMEOUT");
    expect((await request(a).get("/api/v1/x/events")).body).toEqual({ streamed: true });
  });
  it("never trusts every proxy hop in strict profiles", () => {
    expect(trustProxySetting("1")).toBe(1);
    expect(trustProxySetting("10.0.0.0/8, 172.16.0.0/12")).toEqual(["10.0.0.0/8", "172.16.0.0/12"]);
    process.env.APP_ENV = "production";
    expect(trustProxySetting("true")).toBe(false);
    delete process.env.APP_ENV;
    expect(trustProxySetting("")).toBe(false);
  });
  it("drops wildcard CORS origins", () => {
    expect(allowedOrigins({ CORS_ALLOWED_ORIGINS: "https://crm.example.com, *" })).toEqual(["https://crm.example.com"]);
  });
  it("disables the legacy bearer API in staging and production unless re-enabled", () => {
    expect(legacyUserApiEnabled({})).toBe(true);
    expect(legacyUserApiEnabled({ APP_ENV: "production" })).toBe(false);
    expect(legacyUserApiEnabled({ APP_ENV: "staging", LEGACY_USER_API: "true" })).toBe(true);
  });
});
