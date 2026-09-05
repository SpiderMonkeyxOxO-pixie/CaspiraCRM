import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import JoinAcceptance from "./JoinAcceptance";
import authReducer from "../../redux/authSlice";

function renderJoin(token) {
  localStorage.clear();
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { isLoggedIn: false, role: "", data: {} } },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/join/${token}`]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/join/:token" element={<JoinAcceptance />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("JoinAcceptance", () => {
  beforeEach(() => localStorage.clear());

  it("shows Invalid Token for an unknown link", async () => {
    renderJoin("does-not-exist");
    expect(await screen.findByText("Invalid invite link")).toBeInTheDocument();
  });

  it("shows Revoked for a revoked link", async () => {
    renderJoin("preview_link_marketing_old");
    expect(await screen.findByText("Link revoked")).toBeInTheDocument();
  });

  it("shows Usage Limit Reached for a link at capacity", async () => {
    renderJoin("preview_link_general");
    expect(await screen.findByText("Link usage limit reached")).toBeInTheDocument();
  });

  it("shows Expiring Soon links as a working join form (not yet expired)", async () => {
    renderJoin("preview_link_support_core");
    expect(await screen.findByRole("button", { name: /Join Organization/i })).toBeInTheDocument();
  });

  it("shows the domain restriction and rejects a disallowed email", async () => {
    const user = userEvent.setup();
    renderJoin("preview_link_sales_west");
    expect(await screen.findByText(/Restricted to: caspira\.example/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Your name"), "Test Joiner");
    await user.type(screen.getByLabelText("Your email"), "test.joiner@notallowed.com");
    await user.click(screen.getByRole("button", { name: /Join Organization|Request to Join/i }));

    await waitFor(() => expect(screen.getByText(/email domain isn't on this link's allowed list/i)).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it("rejects an email that already belongs to an active member", async () => {
    const user = userEvent.setup();
    renderJoin("preview_link_sales_west");
    await screen.findByRole("button", { name: /Join Organization|Request to Join/ });

    await user.type(screen.getByLabelText("Your name"), "Amara Okafor");
    await user.type(screen.getByLabelText("Your email"), "amara.okafor@caspira.example");
    await user.click(screen.getByRole("button", { name: /Join Organization|Request to Join/ }));

    await waitFor(() => expect(screen.getByText(/already belongs to an active member/i)).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it("shows admin-approval notice and completes the request-to-join flow", async () => {
    const user = userEvent.setup();
    renderJoin("preview_link_sales_west");
    expect(await screen.findByText(/requires admin approval/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Your name"), "Jordan Lee");
    await user.type(screen.getByLabelText("Your email"), "jordan.lee@caspira.example");
    await user.click(screen.getByRole("button", { name: "Request to Join" }));

    await waitFor(() => expect(screen.getByText("Awaiting admin approval")).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it("joins immediately when the link doesn't require approval", async () => {
    const user = userEvent.setup();
    renderJoin("preview_link_support_core");
    await screen.findByRole("button", { name: "Join Organization" });

    await user.type(screen.getByLabelText("Your name"), "Casey Kim");
    await user.type(screen.getByLabelText("Your email"), "casey.kim@caspira.example");
    await user.click(screen.getByRole("button", { name: "Join Organization" }));

    await waitFor(() => expect(screen.getByText("Membership created (preview)")).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);
});
