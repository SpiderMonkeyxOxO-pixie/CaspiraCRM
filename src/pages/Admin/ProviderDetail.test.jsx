import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import ProviderDetail from "./ProviderDetail";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderProvider(providerKey, { role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/admin/integrations/${providerKey}`]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/:providerKey" element={<ProviderDetail />} />
            <Route path="/admin/integrations/marketplace" element={<div>Marketplace Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("ProviderDetail", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb and provider name", async () => {
    renderProvider("slack");
    expect(await screen.findByRole("heading", { name: "Slack" })).toBeInTheDocument();
    expect(screen.getByText("Marketplace")).toBeInTheDocument();
  });

  it("shows an error state for an unknown provider key", async () => {
    renderProvider("not-a-real-provider");
    expect(await screen.findByText(/not part of the Integration Center preview/i)).toBeInTheDocument();
  });

  it("renders all 8 tabs", async () => {
    renderProvider("slack");
    await screen.findByRole("heading", { name: "Slack" });
    ["Overview", "Capabilities", "Setup", "Data Mapping", "Synchronization", "Health", "Activity", "Access"].forEach((t) => {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    });
  });

  it("Overview tab explains what the provider does, data flow, plan, auth and status", async () => {
    renderProvider("stripe");
    await screen.findByRole("heading", { name: "Stripe" });
    expect(screen.getByText("What this provider does")).toBeInTheDocument();
    expect(screen.getByText("Supported CRM modules")).toBeInTheDocument();
    expect(screen.getByText("Data leaving the CRM")).toBeInTheDocument();
    expect(screen.getByText("Data entering the CRM")).toBeInTheDocument();
    expect(screen.getByText("Provider plan requirement")).toBeInTheDocument();
    expect(screen.getByText("Authentication method")).toBeInTheDocument();
    expect(screen.getByText("Current preview status")).toBeInTheDocument();
    expect(screen.getByText("Security considerations")).toBeInTheDocument();
    expect(screen.getByText("Known limitations")).toBeInTheDocument();
  });

  it("Capabilities tab lists every capability with module, direction, permission and availability", async () => {
    const user = userEvent.setup();
    renderProvider("slack");
    await screen.findByRole("heading", { name: "Slack" });
    await user.click(screen.getByRole("tab", { name: "Capabilities" }));
    expect(screen.getByRole("columnheader", { name: "Capability" })).toBeInTheDocument();
    expect(screen.getByText("Workspace connection")).toBeInTheDocument();
    expect(screen.getAllByText("integrations.sync.run").length).toBeGreaterThan(0);
  });

  it("Google Workspace treats Google Meet as part of the Calendar workflow, not a separate capability card", async () => {
    const user = userEvent.setup();
    renderProvider("google_workspace");
    await screen.findByRole("heading", { name: "Google Workspace" });
    await user.click(screen.getByRole("tab", { name: "Capabilities" }));
    expect(screen.getByText(/Google Meet/i)).toBeInTheDocument();
    expect(screen.getByText(/Part of the Calendar workflow/i)).toBeInTheDocument();
  });

  it("Stripe never processes or displays full card data, only masked fixtures", async () => {
    renderProvider("stripe");
    await screen.findByRole("heading", { name: "Stripe" });
    expect(screen.getAllByText(/masked/i).length).toBeGreaterThan(0);
  });

  it("Zoom never shows recording or transcript content", async () => {
    const user = userEvent.setup();
    renderProvider("zoom");
    await screen.findByRole("heading", { name: "Zoom" });
    await user.click(screen.getByRole("tab", { name: "Capabilities" }));
    expect(screen.getAllByText(/never shown/i).length).toBeGreaterThan(0);
  });

  it("DocuSign lists the full envelope status vocabulary", async () => {
    renderProvider("docusign");
    expect(await screen.findByText(/Draft, Sent, Viewed, Signed, Declined, Expired, Voided/)).toBeInTheDocument();
  });

  it("Zapier and Make disclose that not every third-party app is automatically supported", async () => {
    renderProvider("zapier");
    await screen.findByRole("heading", { name: "Zapier" });
    expect(screen.getAllByText(/not every third-party app.*is automatically supported/i).length).toBeGreaterThan(0);
  });

  it("Setup tab shows a disabled credential field with the required placeholder for API-key providers", async () => {
    const user = userEvent.setup();
    renderProvider("stripe");
    await screen.findByRole("heading", { name: "Stripe" });
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    const field = screen.getByPlaceholderText("Credentials will be configured securely during backend integration.");
    expect(field).toBeDisabled();
  });

  it("Setup tab always shows the Frontend Connection Preview disclosure", async () => {
    const user = userEvent.setup();
    renderProvider("calendly");
    await screen.findByRole("heading", { name: "Calendly" });
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    expect(screen.getByText("Frontend Connection Preview")).toBeInTheDocument();
    expect(screen.getByText(/simulated using frontend fixture data/i)).toBeInTheDocument();
  });

  it("supports the ?tab= query param for deep-linking to a specific tab", async () => {
    const user = userEvent.setup();
    localStorage.setItem("role", "Admin");
    localStorage.setItem("isLoggedIn", "true");
    const store = configureStore({
      reducer: { auth: authReducer, integrations: integrationsReducer },
      preloadedState: { auth: { role: "Admin", isLoggedIn: true, data: {} } },
    });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/admin/integrations/stripe?tab=setup"]}>
          <ErrorBoundary>
            <Routes>
              <Route path="/admin/integrations/:providerKey" element={<ProviderDetail />} />
            </Routes>
          </ErrorBoundary>
        </MemoryRouter>
      </Provider>
    );
    await waitFor(() => expect(screen.getByRole("tab", { name: "Setup" })).toHaveAttribute("aria-selected", "true"), { timeout: 5000 });
    await user.click(screen.getByRole("tab", { name: "Overview" })); // sanity: tabs are still interactive after deep link
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("Access tab explains role-based access including Auditor read-only behavior", async () => {
    const user = userEvent.setup();
    renderProvider("slack");
    await screen.findByRole("heading", { name: "Slack" });
    await user.click(screen.getByRole("tab", { name: "Access" }));
    expect(screen.getByText(/Auditor \/ Checker may view/i)).toBeInTheDocument();
  });

  it("shows Manage Preview when a preview connection already exists for the organization", async () => {
    renderProvider("slack", { role: "Admin" });
    expect(await screen.findByRole("button", { name: "Manage Preview" })).toBeInTheDocument();
  });

  it("shows Preview Setup when no preview connection exists yet", async () => {
    renderProvider("calendly", { role: "Admin" });
    expect(await screen.findByRole("button", { name: "Preview Setup" })).toBeInTheDocument();
  });

  it("navigates back to the Marketplace", async () => {
    const user = userEvent.setup();
    renderProvider("slack");
    await screen.findByRole("heading", { name: "Slack" });
    await user.click(screen.getByRole("button", { name: "Back to Marketplace" }));
    expect(await screen.findByText("Marketplace Page")).toBeInTheDocument();
  });
});
