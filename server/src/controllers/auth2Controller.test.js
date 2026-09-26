import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserFindFirst = vi.fn();
const mockUserFindUnique = vi.fn();
const mockRefreshFindUnique = vi.fn();
const mockRefreshCreate = vi.fn();
const mockRefreshUpdate = vi.fn();
const mockRefreshUpdateMany = vi.fn();
const mockTransaction = vi.fn((cb) => cb({ refreshSession: { updateMany: mockRefreshUpdateMany }, user: { findUnique: mockUserFindUnique } }));
const mockCodeUpdateMany = vi.fn(async () => ({ count: 1 }));

vi.mock("../lib/prisma.js", () => ({
  default: {
    user: { findFirst: (...a) => mockUserFindFirst(...a), findUnique: (...a) => mockUserFindUnique(...a) },
    refreshSession: {
      findUnique: (...a) => mockRefreshFindUnique(...a),
      create: (...a) => mockRefreshCreate(...a),
      update: (...a) => mockRefreshUpdate(...a),
      updateMany: (...a) => mockRefreshUpdateMany(...a),
    },
    mfaRecoveryCode: { updateMany: (...a) => mockCodeUpdateMany(...a), count: async () => 9 },
    $transaction: (...a) => mockTransaction(...a),
  },
}));

const mockRecordAuditEvent = vi.fn();
vi.mock("../services/auditService.js", () => ({
  recordAuditEvent: (...a) => mockRecordAuditEvent(...a),
  requestContext: (req) => ({ correlationId: "test-corr", ipAddress: req.ip || "127.0.0.1", userAgent: "test-agent" }),
}));

const mockRecordOutboxEvent = vi.fn();
vi.mock("../services/outboxService.js", () => ({ recordOutboxEvent: (...a) => mockRecordOutboxEvent(...a) }));

const { login, refresh, logout } = await import("./auth2Controller.js");
const { verifyPassword } = await import("../utils/password.js");
const { REFRESH_COOKIE } = await import("../utils/cookies.js");

vi.mock("../utils/password.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, verifyPassword: vi.fn() };
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  return res;
}

const ACTIVE_USER = { id: "u1", email: "owner@caspira.example", passwordHash: "hash", role: "Super-Admin", status: "Active", name: "Owner" };

describe("auth2Controller.login", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing credentials with 400", async () => {
    const res = mockRes();
    await login({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns the SAME generic message whether the account doesn't exist or the password is wrong (no enumeration)", async () => {
    mockUserFindFirst.mockResolvedValueOnce(null);
    const resNoAccount = mockRes();
    await login({ body: { email: "nobody@x.com", password: "x" } }, resNoAccount);

    mockUserFindFirst.mockResolvedValueOnce(ACTIVE_USER);
    verifyPassword.mockResolvedValueOnce(false);
    const resWrongPassword = mockRes();
    await login({ body: { email: ACTIVE_USER.email, password: "wrong" } }, resWrongPassword);

    expect(resNoAccount.status).toHaveBeenCalledWith(401);
    expect(resWrongPassword.status).toHaveBeenCalledWith(401);
    expect(resNoAccount.json.mock.calls[0][0]).toEqual(resWrongPassword.json.mock.calls[0][0]);
  });

  it("rejects a disabled/non-Active account with the same generic message", async () => {
    mockUserFindFirst.mockResolvedValueOnce({ ...ACTIVE_USER, status: "Suspended" });
    const res = mockRes();
    await login({ body: { email: ACTIVE_USER.email, password: "whatever" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: "INVALID_CREDENTIALS", message: "Invalid email or password." });
  });

  it("issues access, refresh and csrf cookies on success and never puts the raw refresh token in the JSON body", async () => {
    mockUserFindFirst.mockResolvedValueOnce(ACTIVE_USER);
    verifyPassword.mockResolvedValueOnce(true);
    mockRefreshCreate.mockResolvedValueOnce({ id: "rs1" });
    const res = mockRes();
    await login({ body: { email: ACTIVE_USER.email, password: "correct" } }, res);

    expect(res.status).not.toHaveBeenCalledWith(401);
    const cookieNames = res.cookie.mock.calls.map((c) => c[0]);
    expect(cookieNames).toEqual(expect.arrayContaining(["csrm_access", "csrm_refresh", "csrm_csrf"]));
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain(res.cookie.mock.calls.find((c) => c[0] === "csrm_refresh")[1]);
  });

  it("accepts a username in place of an email, looking it up by username", async () => {
    mockUserFindFirst.mockResolvedValueOnce(ACTIVE_USER);
    verifyPassword.mockResolvedValueOnce(true);
    mockRefreshCreate.mockResolvedValueOnce({ id: "rs1" });
    const res = mockRes();
    await login({ body: { username: "owner", password: "correct" } }, res);

    expect(mockUserFindFirst).toHaveBeenCalledWith({ where: { username: { equals: "owner", mode: "insensitive" } } });
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it("records an audit event on both success and failure", async () => {
    mockUserFindFirst.mockResolvedValueOnce(null);
    await login({ body: { email: "nobody@x.com", password: "x" } }, mockRes());
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.login", result: "Failure" }));

    mockRecordAuditEvent.mockClear();
    mockUserFindFirst.mockResolvedValueOnce(ACTIVE_USER);
    verifyPassword.mockResolvedValueOnce(true);
    mockRefreshCreate.mockResolvedValueOnce({ id: "rs1" });
    await login({ body: { email: ACTIVE_USER.email, password: "correct" } }, mockRes());
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.login", result: "Success" }));
  });
});

describe("auth2Controller.refresh — rotation and reuse detection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when no refresh cookie is present", async () => {
    const res = mockRes();
    await refresh({ cookies: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rotates: revokes the old session and issues a new one on the same family", async () => {
    mockRefreshFindUnique.mockResolvedValueOnce({ id: "old", userId: "u1", familyId: "fam-1", revokedAt: null, expiresAt: new Date(Date.now() + 100000) });
    mockUserFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    mockRefreshCreate.mockResolvedValueOnce({ id: "new" });
    const res = mockRes();
    await refresh({ cookies: { [REFRESH_COOKIE]: "raw-refresh-token" } }, res);

    expect(mockRefreshCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ familyId: "fam-1" }) }));
    expect(mockRefreshUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "old" }, data: expect.objectContaining({ revokedReason: "rotated", replacedById: "new" }) }));
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it("detects reuse of an already-revoked token, revokes the whole family, and denies the request", async () => {
    mockRefreshFindUnique.mockResolvedValueOnce({ id: "old", userId: "u1", familyId: "fam-1", revokedAt: new Date(), expiresAt: new Date(Date.now() + 100000) });
    const res = mockRes();
    await refresh({ cookies: { [REFRESH_COOKIE]: "stolen-old-token" } }, res);

    expect(mockRefreshUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: "fam-1", revokedAt: null }, data: expect.objectContaining({ revokedReason: "reuse_detected" }) }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "SESSION_REVOKED" }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.refresh_reuse_detected", result: "Denied" }));
    // A stolen token must never get a fresh session issued.
    expect(mockRefreshCreate).not.toHaveBeenCalled();
  });

  it("rejects an expired (but not yet revoked) refresh session", async () => {
    mockRefreshFindUnique.mockResolvedValueOnce({ id: "old", userId: "u1", familyId: "fam-1", revokedAt: null, expiresAt: new Date(Date.now() - 1000) });
    const res = mockRes();
    await refresh({ cookies: { [REFRESH_COOKIE]: "expired-token" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "SESSION_EXPIRED" }));
  });
});

describe("auth2Controller.logout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears cookies even when there was no session to revoke", async () => {
    const res = mockRes();
    await logout({ cookies: {} }, res);
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: "Logged out" });
  });

  it("revokes the presented session and records an audit event", async () => {
    mockRefreshFindUnique.mockResolvedValueOnce({ id: "rs1", userId: "u1", revokedAt: null });
    const res = mockRes();
    await logout({ cookies: { [REFRESH_COOKIE]: "raw-token" } }, res);
    expect(mockRefreshUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "rs1" }, data: expect.objectContaining({ revokedReason: "logout" }) }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.logout", result: "Success" }));
  });
});

// ─── Backend Phase 13 — session hardening ───────────────────────────────────
const { requireLiveSession, requireRecentAuth } = await import("./auth2Controller.js");
const { verifyToken } = await import("../utils/jwt.js");
const speakeasy = (await import("speakeasy")).default;

describe("Phase 13 — MFA, absolute lifetime and privileged-action checks", () => {
  beforeEach(() => vi.clearAllMocks());
  const MFA_USER = { ...ACTIVE_USER, twoFactorEnabled: true, twoFactorSecret: speakeasy.generateSecret().base32 };

  it("requires the TOTP code on session login for accounts with two-factor enabled", async () => {
    mockUserFindFirst.mockResolvedValueOnce(MFA_USER);
    verifyPassword.mockResolvedValueOnce(true);
    const res = mockRes();
    await login({ body: { username: "owner", password: "correct" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].code).toBe("MFA_REQUIRED");
    expect(res.cookie).not.toHaveBeenCalled();

    mockUserFindFirst.mockResolvedValueOnce(MFA_USER);
    verifyPassword.mockResolvedValueOnce(true);
    const bad = mockRes();
    await login({ body: { username: "owner", password: "correct", otp: "000000" } }, bad);
    expect(bad.json.mock.calls[0][0].code).toBe("MFA_INVALID");

    mockUserFindFirst.mockResolvedValueOnce(MFA_USER);
    verifyPassword.mockResolvedValueOnce(true);
    mockRefreshCreate.mockResolvedValueOnce({ id: "rs9" });
    const ok = mockRes();
    await login({ body: { username: "owner", password: "correct", otp: speakeasy.totp({ secret: MFA_USER.twoFactorSecret, encoding: "base32" }) } }, ok);
    expect(ok.cookie.mock.calls.map((c) => c[0])).toContain("csrm_access");
  });

  it("accepts a recovery code in place of the authenticator code, audits it and sends an email", async () => {
    mockUserFindFirst.mockResolvedValueOnce(MFA_USER);
    verifyPassword.mockResolvedValueOnce(true);
    mockRefreshCreate.mockResolvedValueOnce({ id: "rs10" });
    const ok = mockRes();
    await login({ body: { username: "owner", password: "correct", otp: "abcd-efgh-jkmn-pqrs" } }, ok);
    expect(ok.cookie.mock.calls.map((c) => c[0])).toContain("csrm_access");
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.mfa_recovery_code_used", after: { remaining: 9 } }));
    expect(mockRecordOutboxEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "mfa_recovery_code_used" }));

    mockUserFindFirst.mockResolvedValueOnce(MFA_USER);
    verifyPassword.mockResolvedValueOnce(true);
    mockCodeUpdateMany.mockResolvedValueOnce({ count: 0 });
    const used = mockRes();
    await login({ body: { username: "owner", password: "correct", otp: "abcd-efgh-jkmn-pqrs" } }, used);
    expect(used.json.mock.calls[0][0].code).toBe("MFA_INVALID");
  });

  it("puts the session id and authentication time in the access token", async () => {
    mockUserFindFirst.mockResolvedValueOnce(ACTIVE_USER);
    verifyPassword.mockResolvedValueOnce(true);
    mockRefreshCreate.mockResolvedValueOnce({ id: "rs1" });
    const res = mockRes();
    await login({ body: { username: "owner", password: "correct" } }, res);
    const claims = verifyToken(res.cookie.mock.calls.find((c) => c[0] === "csrm_access")[1]);
    expect(claims.sid).toBeTruthy();
    expect(Math.abs(claims.auth_time * 1000 - Date.now())).toBeLessThan(5000);
    expect(mockRefreshCreate.mock.calls[0][0].data.absoluteExpiresAt).toBeInstanceOf(Date);
  });

  it("refresh can't extend a session past its absolute lifetime", async () => {
    mockRefreshFindUnique.mockResolvedValueOnce({ id: "old", userId: "u1", familyId: "fam-1", revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000), absoluteExpiresAt: new Date(Date.now() - 1000) });
    const res = mockRes();
    await refresh({ cookies: { [REFRESH_COOKIE]: "token" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRefreshCreate).not.toHaveBeenCalled();
  });

  it("requireRecentAuth demands a password check within the window", () => {
    const gate = requireRecentAuth(10);
    const next = vi.fn();
    gate({ auth: { auth_time: Math.floor(Date.now() / 1000) - 60 } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
    const res = mockRes();
    gate({ auth: { auth_time: Math.floor(Date.now() / 1000) - 11 * 60 } }, res, vi.fn());
    expect(res.json.mock.calls[0][0].code).toBe("REAUTHENTICATION_REQUIRED");
    const none = mockRes();
    gate({ auth: {} }, none, vi.fn());
    expect(none.status).toHaveBeenCalledWith(401);
  });

  it("requireLiveSession rejects revoked, foreign and expired sessions and follows rotation", async () => {
    const run = async (session, chain = []) => {
      mockRefreshFindUnique.mockResolvedValueOnce(session);
      for (const s of chain) mockRefreshFindUnique.mockResolvedValueOnce(s);
      const res = mockRes(); const next = vi.fn();
      await requireLiveSession({ auth: { sid: "s1" }, user: { id: "u1" } }, res, next);
      return next.mock.calls.length ? "next" : res.json.mock.calls[0][0].code;
    };
    expect(await run({ id: "s1", userId: "u1", revokedAt: null })).toBe("next");
    expect(await run({ id: "s1", userId: "u1", revokedAt: new Date(), revokedReason: "logout" })).toBe("SESSION_REVOKED");
    expect(await run({ id: "s1", userId: "u2", revokedAt: null })).toBe("SESSION_REVOKED");
    expect(await run({ id: "s1", userId: "u1", revokedAt: null, absoluteExpiresAt: new Date(Date.now() - 1) })).toBe("SESSION_REVOKED");
    expect(await run({ id: "s1", userId: "u1", revokedAt: new Date(), revokedReason: "rotated", replacedById: "s2" }, [{ id: "s2", revokedAt: null }])).toBe("next");
    expect(await run({ id: "s1", userId: "u1", revokedAt: new Date(), revokedReason: "rotated", replacedById: "s2" }, [{ id: "s2", revokedAt: new Date(), revokedReason: "reuse_detected" }])).toBe("SESSION_REVOKED");
    const res = mockRes();
    await requireLiveSession({ auth: {}, user: { id: "u1" } }, res, vi.fn());
    expect(res.json.mock.calls[0][0].code).toBe("SESSION_REQUIRED");
  });
});
