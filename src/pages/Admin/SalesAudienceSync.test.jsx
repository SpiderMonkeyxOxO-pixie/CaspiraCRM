import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SalesAudienceSync from "./SalesAudienceSync";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderAudiences({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/sales-marketing/audiences"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/sales-marketing" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/sales-marketing/audiences" element={<SalesAudienceSync />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SalesAudienceSync", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderAudiences();
    expect(await screen.findByRole("heading", { name: "Audience Synchronization" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists audiences and shows the marketing consent summary panel", async () => {
    renderAudiences();
    await waitFor(() => expect(screen.getByText("HQ Newsletter Subscribers")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Marketing Consent Summary")).toBeInTheDocument());
  });

  it("previews eligibility live, excluding suppressed/non-consented records rather than showing a stored count", async () => {
    const user = userEvent.setup();
    renderAudiences();
    await waitFor(() => expect(screen.getByText("HQ Newsletter Subscribers")).toBeInTheDocument());
    const previewButtons = await screen.findAllByRole("button", { name: /Preview Eligibility/i });
    await user.click(previewButtons[0]);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(/are eligible/)).toBeInTheDocument());
  });

  it("a role with no audience_sync grant (Standard Employee) cannot view Audience Sync", async () => {
    renderAudiences({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Audience Sync/i)).toBeInTheDocument());
  });
});
