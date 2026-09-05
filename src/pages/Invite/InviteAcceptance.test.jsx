import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import InviteAcceptance from "./InviteAcceptance";
import authReducer from "../../redux/authSlice";

function renderInvite(token, { isLoggedIn = false, role = "", data = {} } = {}) {
  localStorage.clear();
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { isLoggedIn, role, data } },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/invite/${token}`]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/invite/:token" element={<InviteAcceptance />} />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("InviteAcceptance", () => {
  beforeEach(() => localStorage.clear());

  it("shows Invalid Token for an unknown token", async () => {
    renderInvite("does-not-exist", { isLoggedIn: true, data: { email: "someone@caspira.example" } });
    expect(await screen.findByText("Invalid invitation link")).toBeInTheDocument();
  });

  it("shows Expired for an expired invitation", async () => {
    renderInvite("preview_tok_inv6", { isLoggedIn: true, data: { email: "expired.person@caspira.example" } });
    expect(await screen.findByText("Invitation expired")).toBeInTheDocument();
  });

  it("shows Revoked for a revoked invitation", async () => {
    renderInvite("preview_tok_inv7", { isLoggedIn: true, data: { email: "revoked.person@caspira.example" } });
    expect(await screen.findByText("Invitation revoked")).toBeInTheDocument();
  });

  it("shows Declined for an already-declined invitation", async () => {
    renderInvite("preview_tok_inv5", { isLoggedIn: true, data: { email: "declined.preview@caspira.example" } });
    expect(await screen.findByText("Invitation declined")).toBeInTheDocument();
  });

  it("shows Already Accepted for an already-accepted invitation", async () => {
    renderInvite("preview_tok_inv4", { isLoggedIn: true, data: { email: "accepted.preview@caspira.example" } });
    expect(await screen.findByText("Membership accepted (preview)")).toBeInTheDocument();
  });

  it("shows the pending-approval state for an invitation already awaiting approval", async () => {
    renderInvite("preview_tok_inv3", { isLoggedIn: true, data: { email: "pending.approval@caspira.example" } });
    expect(await screen.findByText("Awaiting admin approval")).toBeInTheDocument();
  });

  it("shows Sign-in Required when not logged in", async () => {
    renderInvite("preview_tok_inv1", { isLoggedIn: false });
    expect(await screen.findByText("Sign in to continue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
  });

  it("navigates to /login from Sign-in Required", async () => {
    const user = userEvent.setup();
    renderInvite("preview_tok_inv1", { isLoggedIn: false });
    await user.click(await screen.findByRole("button", { name: "Sign In" }));
    expect(await screen.findByText("Login Page")).toBeInTheDocument();
  });

  it("shows Email Mismatch when the signed-in email differs, with a way to continue anyway", async () => {
    const user = userEvent.setup();
    renderInvite("preview_tok_inv1", { isLoggedIn: true, data: { email: "someone.else@caspira.example" } });
    expect(await screen.findByText("Signed in with a different email")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Continue as new\.hire@caspira\.example/i }));
    expect(await screen.findByRole("button", { name: "Accept Invitation" })).toBeInTheDocument();
  });

  it("completes the full accept flow for a matching, non-approval invitation", async () => {
    const user = userEvent.setup();
    renderInvite("preview_tok_inv1", { isLoggedIn: true, data: { email: "new.hire@caspira.example", name: "New Hire" } });
    await screen.findByRole("button", { name: "Accept Invitation" });
    await user.click(screen.getByRole("button", { name: "Accept Invitation" }));
    await waitFor(() => expect(screen.getByText("Membership accepted (preview)")).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it("completes the decline flow", async () => {
    const user = userEvent.setup();
    renderInvite("preview_tok_inv9", { isLoggedIn: true, data: { email: "expiring.soon@caspira.example" } });
    await screen.findByRole("button", { name: "Decline" });
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.getByText("Invitation declined")).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it("accepts an invitation belonging to a different organization", async () => {
    const user = userEvent.setup();
    renderInvite("preview_tok_inv10", { isLoggedIn: true, data: { email: "new.admin.candidate@nimbusretail.example" } });
    await screen.findByRole("button", { name: "Accept Invitation" });
    await user.click(screen.getByRole("button", { name: "Accept Invitation" }));
    await waitFor(() => expect(screen.getByText("Membership accepted (preview)")).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);
});
