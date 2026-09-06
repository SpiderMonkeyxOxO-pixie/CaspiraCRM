import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The script's own `import "dotenv/config"` would otherwise reload
// server/.env on every vi.resetModules() re-import below, clobbering the
// exact env-var scenarios each test sets up.
vi.mock("dotenv/config", () => ({}));

const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
vi.mock("../src/lib/prisma.js", () => ({
  default: { user: { findFirst: (...a) => mockFindFirst(...a), create: (...a) => mockCreate(...a) } },
}));

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_EXIT = process.exit;

async function runScript() {
  vi.resetModules();
  const { main } = await import("./bootstrapSystemOwner.js");
  await main();
}

describe("bootstrapSystemOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.exit = vi.fn();
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    process.exit = ORIGINAL_EXIT;
  });

  it("refuses to run when ALLOW_SYSTEM_OWNER_BOOTSTRAP is not exactly \"true\"", async () => {
    delete process.env.ALLOW_SYSTEM_OWNER_BOOTSTRAP;
    await runScript();
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("is idempotent — a no-op when a System Owner already exists", async () => {
    process.env.ALLOW_SYSTEM_OWNER_BOOTSTRAP = "true";
    mockFindFirst.mockResolvedValueOnce({ email: "owner@existing.example" });
    await runScript();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("refuses when credentials are missing — there is no default password", async () => {
    process.env.ALLOW_SYSTEM_OWNER_BOOTSTRAP = "true";
    delete process.env.BOOTSTRAP_OWNER_PASSWORD;
    mockFindFirst.mockResolvedValueOnce(null);
    await runScript();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("creates exactly one Super-Admin user when properly configured and none exists yet", async () => {
    process.env.ALLOW_SYSTEM_OWNER_BOOTSTRAP = "true";
    process.env.BOOTSTRAP_OWNER_EMAIL = "newowner@example.com";
    process.env.BOOTSTRAP_OWNER_USERNAME = "newowner";
    process.env.BOOTSTRAP_OWNER_PASSWORD = "a-fine-long-password";
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ email: "newowner@example.com", username: "newowner" });
    await runScript();
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate.mock.calls[0][0].data.role).toBe("Super-Admin");
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
