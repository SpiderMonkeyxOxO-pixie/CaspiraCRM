import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = { listTokens: vi.fn(), createToken: vi.fn(), revokeToken: vi.fn() };
vi.mock("../../../Helpers/backendPlatformClient", () => ({
  listTokens: (...a) => api.listTokens(...a), createToken: (...a) => api.createToken(...a), revokeToken: (...a) => api.revokeToken(...a),
}));
const { default: AutomationTokens } = await import("./AutomationTokens");

const ACTIVE = { id: "pat_1", name: "host scripts", scopes: ["release:register"], expiresAt: "2099-01-01T00:00:00Z", lastUsedAt: null, revokedAt: null };
const REVOKED = { ...ACTIVE, id: "pat_2", name: "old", revokedAt: "2026-09-01T00:00:00Z" };

describe("Automation tokens", () => {
  beforeEach(() => { for (const f of Object.values(api)) f.mockReset(); api.listTokens.mockResolvedValue({ tokens: [ACTIVE, REVOKED] }); });

  it("lists tokens with their status and revokes only active ones", async () => {
    render(<AutomationTokens />);
    expect(await screen.findByText("host scripts")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    const revoke = screen.getAllByRole("button", { name: "Revoke" });
    expect(revoke).toHaveLength(1);
    api.revokeToken.mockResolvedValue({ ok: true });
    fireEvent.click(revoke[0]);
    await waitFor(() => expect(api.revokeToken).toHaveBeenCalledWith("pat_1"));
  });

  it("creates a token for the host scripts and shows it once", async () => {
    api.createToken.mockResolvedValue({ id: "pat_3", token: "cpat_pat_3.secretvalue" });
    render(<AutomationTokens />);
    fireEvent.click(await screen.findByRole("button", { name: "Create token…" }));
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(api.createToken).toHaveBeenCalledWith({ name: "production host scripts", scopes: ["release:register", "deployment:read", "deployment:report"], days: 30 }));
    expect(await screen.findByText("cpat_pat_3.secretvalue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I've saved it" }));
    expect(screen.queryByText("cpat_pat_3.secretvalue")).not.toBeInTheDocument();
  });
});
