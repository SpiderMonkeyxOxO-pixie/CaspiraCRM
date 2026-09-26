import { describe, it, expect } from "vitest";

describe("startupEnv", () => {
  it("keeps the environment as it was at startup, unaffected by later changes", async () => {
    delete process.env.CASPIRA_STARTUP_ENV_PROBE;
    const { startupEnv } = await import("./startupEnv.js");
    process.env.CASPIRA_STARTUP_ENV_PROBE = "resolved-later";
    expect(startupEnv.CASPIRA_STARTUP_ENV_PROBE).toBeUndefined();
    expect(Object.isFrozen(startupEnv)).toBe(true);
    delete process.env.CASPIRA_STARTUP_ENV_PROBE;
  });
});
