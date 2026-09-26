import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import authReducer from "../../redux/authSlice";

vi.mock("../../Helpers/backendAuthClient", () => ({
  BACKEND_AUTH_MODE_ENABLED: true,
  getCurrentUser: vi.fn(async () => ({ user: { ...USER, fullName: "Ada Lovelace" } })),
  updateMyProfile: vi.fn(async () => ({})),
  changeMyPassword: vi.fn(async () => ({ message: "Password changed." })),
  listSessions: vi.fn(async () => ({ sessions: [
    { _id: "s1", current: true, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36", ipAddress: "10.0.0.1", createdAt: "2026-09-26T08:00:00Z" },
    { _id: "s2", current: false, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1", ipAddress: "10.0.0.2", createdAt: "2026-09-25T08:00:00Z" },
  ] })),
  revokeSession: vi.fn(async () => ({})),
  revokeOtherSessions: vi.fn(async () => ({})),
  reauthenticate: vi.fn(async () => ({})),
  startMfaSetup: vi.fn(),
  enableMfa: vi.fn(async () => ({ twoFactorEnabled: true })),
  disableMfa: vi.fn(async () => ({ twoFactorEnabled: false })),
}));

const api = await import("../../Helpers/backendAuthClient");
const { default: Settings } = await import("./Settings");
const USER = { _id: "u1", username: "owner", email: "owner@caspira.example", fullName: "System Owner", role: "Super-Admin", twoFactorEnabled: false };

function renderSettings(path = "/settings") {
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: { role: "Super-Admin", isLoggedIn: true, data: USER } } });
  return render(<Provider store={store}><MemoryRouter initialEntries={[path]}><Settings /></MemoryRouter></Provider>);
}

describe("Settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("edits the full name and saves it through the account API", async () => {
    renderSettings();
    const name = screen.getByLabelText("Full name");
    expect(name).toHaveValue("System Owner");
    expect(screen.getByLabelText("Email")).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.type(name, "Ada Lovelace");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith({ fullName: "Ada Lovelace", phone: "" }));
  });

  it("only enables Change password when the new password meets the rules", async () => {
    renderSettings();
    const button = screen.getByRole("button", { name: "Change password" });
    await userEvent.type(screen.getByLabelText("Current password"), "old-Pass-1");
    await userEvent.type(screen.getByLabelText("New password"), "short1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "short1");
    expect(button).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.clear(screen.getByLabelText("Confirm new password"));
    await userEvent.type(screen.getByLabelText("New password"), "Blue-harbour-42");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "Blue-harbour-42");
    await userEvent.click(button);
    await waitFor(() => expect(api.changeMyPassword).toHaveBeenCalledWith("old-Pass-1", "Blue-harbour-42"));
  });

  it("lists real sessions and signs another one out", async () => {
    renderSettings("/settings?tab=security");
    expect(await screen.findByText("Chrome on Windows")).toBeInTheDocument();
    expect(screen.getByText("Safari on iOS")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.revokeSession).toHaveBeenCalledWith("s2"));
  });

  it("asks for the password when needed, then shows the QR code and enables 2FA", async () => {
    api.startMfaSetup
      .mockRejectedValueOnce({ response: { data: { code: "REAUTHENTICATION_REQUIRED" } } })
      .mockResolvedValueOnce({ qrCode: "data:image/png;base64,AAAA", secret: "JBSWY3DPEHPK3PXP" });
    renderSettings("/settings?tab=security");
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await userEvent.type(await screen.findByLabelText("Password"), "my-Password-1");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(api.reauthenticate).toHaveBeenCalledWith("my-Password-1");
    expect(await screen.findByAltText(/QR code/)).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getAllByRole("button", { name: "Turn on" }).at(-1));
    await waitFor(() => expect(api.enableMfa).toHaveBeenCalledWith("123456"));
  });
});
