import { describe, it, expect, vi, beforeEach } from "vitest";
import speakeasy from "speakeasy";

const mockUserUpdate = vi.fn(async ({ data }) => ({ ...USER, ...data }));
const mockRefreshUpdateMany = vi.fn();
const tx = { user: { update: (...a) => mockUserUpdate(...a) }, refreshSession: { updateMany: (...a) => mockRefreshUpdateMany(...a) } };
vi.mock("../lib/prisma.js", () => ({
  default: { user: { update: (...a) => mockUserUpdate(...a) }, $transaction: (cb) => cb(tx) },
}));
const mockAudit = vi.fn();
vi.mock("../services/auditService.js", () => ({ recordAuditEvent: (...a) => mockAudit(...a), requestContext: () => ({ correlationId: "c" }) }));
const mockOutbox = vi.fn();
vi.mock("../services/outboxService.js", () => ({ recordOutboxEvent: (...a) => mockOutbox(...a) }));
vi.mock("../utils/password.js", () => ({
  verifyPassword: vi.fn(async (hash, plain) => plain === "Current-pass-1"),
  hashPassword: vi.fn(async () => "new-hash"),
}));

const { updateMe, changePassword, mfaSetup, mfaEnable, mfaDisable, passwordProblem } = await import("./accountController.js");
const { REFRESH_COOKIE } = await import("../utils/cookies.js");

const USER = { id: "u1", name: "Owner", username: "owner", email: "owner@caspira.example", passwordHash: "hash", twoFactorEnabled: false, twoFactorSecret: null };
const res = () => { const r = {}; r.status = vi.fn(() => r); r.json = vi.fn(() => r); return r; };

describe("accountController", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the name and phone, never other fields", async () => {
    const r = res();
    await updateMe({ user: USER, body: { fullName: "  Ada   Lovelace ", phone: "+374 10 123456", role: "Super-Admin", email: "x@y.z" } }, r);
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { fullName: "Ada Lovelace", name: "Ada Lovelace", phone: "+374 10 123456" } });
    expect(r.json.mock.calls[0][0].user).not.toHaveProperty("passwordHash");
  });

  it("rejects an invalid name or phone", async () => {
    const r1 = res(); await updateMe({ user: USER, body: { fullName: "A" } }, r1);
    const r2 = res(); await updateMe({ user: USER, body: { phone: "call me" } }, r2);
    expect(r1.status).toHaveBeenCalledWith(400); expect(r2.status).toHaveBeenCalledWith(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("applies the password policy", () => {
    expect(passwordProblem("short1", USER)).toMatch(/at least 10/);
    expect(passwordProblem("onlyletterslong", USER)).toMatch(/letter and one number/);
    expect(passwordProblem("owner-password-9", USER)).toMatch(/username or email/);
    expect(passwordProblem("Blue-harbour-42", USER)).toBeNull();
  });

  it("changes the password only with the current one, and ends the other sessions", async () => {
    const wrong = res();
    await changePassword({ user: USER, body: { currentPassword: "nope", newPassword: "Blue-harbour-42" }, cookies: {} }, wrong);
    expect(wrong.status).toHaveBeenCalledWith(401);
    const ok = res();
    await changePassword({ user: USER, body: { currentPassword: "Current-pass-1", newPassword: "Blue-harbour-42" }, cookies: { [REFRESH_COOKIE]: "raw" } }, ok);
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { passwordHash: "new-hash" } });
    expect(mockRefreshUpdateMany.mock.calls[0][0].where.tokenHash).toEqual({ not: expect.any(String) });
    expect(mockOutbox).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: "password_changed" }));
  });

  it("won't replace the secret while 2FA is on", async () => {
    const r = res();
    await mfaSetup({ user: { ...USER, twoFactorEnabled: true, twoFactorSecret: "S" }, body: {} }, r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("sets up, enables and disables 2FA with valid codes only", async () => {
    const setup = res();
    await mfaSetup({ user: USER, body: {} }, setup);
    const { secret, qrCode } = setup.json.mock.calls[0][0];
    expect(qrCode).toMatch(/^data:image\/png;base64,/);
    const pending = { ...USER, twoFactorSecret: secret };

    const bad = res();
    await mfaEnable({ user: pending, body: { otp: "000000" } }, bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    const code = speakeasy.totp({ secret, encoding: "base32" });
    const good = res();
    await mfaEnable({ user: pending, body: { otp: code } }, good);
    expect(good.json).toHaveBeenCalledWith({ twoFactorEnabled: true });
    expect(mockOutbox).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: "mfa_enabled" }));

    const off = res();
    await mfaDisable({ user: { ...pending, twoFactorEnabled: true }, body: { otp: code } }, off);
    expect(mockUserUpdate).toHaveBeenLastCalledWith({ where: { id: "u1" }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  });
});
