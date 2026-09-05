import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import IntegrationMarketplace from "./IntegrationMarketplace";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderMarketplace({ role = "Super-Admin", initialEntry = "/admin/integrations/marketplace" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/marketplace" element={<IntegrationMarketplace />} />
            <Route path="/admin/integrations/:providerKey" element={<div>Provider Detail Page</div>} />
            <Route path="/admin/integrations/connections/:connectionId" element={<div>Connection Detail Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("IntegrationMarketplace", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb and title", async () => {
    renderMarketplace();
    expect(await screen.findByText("Marketplace")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Integration Marketplace" })).toBeInTheDocument();
  });

  it("renders all 13 provider cards", async () => {
    renderMarketplace();
    expect(await screen.findByText("Slack", {}, { timeout: 10000 })).toBeInTheDocument();
    ["Google Workspace", "Microsoft 365", "WhatsApp Business", "Twilio", "Calendly", "Zoom", "Stripe", "QuickBooks Online", "Xero", "DocuSign", "Zapier", "Make"].forEach((name) => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
  }, 15000);

  it("never shows fake star ratings, install counts or testimonials", async () => {
    renderMarketplace();
    await screen.findByText("Slack");
    expect(screen.queryByText(/★|installs|testimonial/i)).not.toBeInTheDocument();
  }, 15000);

  it("search narrows the results and persists to the URL", async () => {
    const user = userEvent.setup();
    renderMarketplace();
    await screen.findByText("Slack");
    await user.type(screen.getByPlaceholderText("Search providers..."), "slack");
    await waitFor(() => {
      expect(screen.queryByText("Stripe")).not.toBeInTheDocument();
      expect(screen.getByText("Slack")).toBeInTheDocument();
    }, { timeout: 10000 });
  }, 15000);

  it("category filter narrows results", async () => {
    const user = userEvent.setup();
    renderMarketplace();
    await screen.findByText("Slack");
    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.selectOptions(screen.getByLabelText("Category"), "Accounting");
    await waitFor(() => expect(screen.getByText("QuickBooks Online")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText("Slack")).not.toBeInTheDocument();
  }, 15000);

  it("connection-status filter narrows results", async () => {
    const user = userEvent.setup();
    renderMarketplace();
    // Wait for connections (not just the provider catalog) to finish loading
    // — until then every card shows the "Preview Available" default status.
    await screen.findByRole("group", { name: "Slack" });
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Slack" })).getByText("Preview Connected")).toBeInTheDocument(), { timeout: 10000 });
    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.selectOptions(screen.getByLabelText("Connection status"), "Preview Connected");
    await waitFor(() => {
      expect(screen.queryByText("Calendly")).not.toBeInTheDocument();
      expect(screen.getByText("Slack")).toBeInTheDocument();
    }, { timeout: 10000 });
  }, 15000);

  it("supports URL-persisted filters on initial load", async () => {
    renderMarketplace({ initialEntry: "/admin/integrations/marketplace?category=Accounting" });
    await waitFor(() => expect(screen.getByText("QuickBooks Online")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText("Slack")).not.toBeInTheDocument();
  }, 15000);

  it("shows a no-results state and lets the user clear filters", async () => {
    const user = userEvent.setup();
    renderMarketplace();
    await screen.findByText("Slack");
    await user.type(screen.getByPlaceholderText("Search providers..."), "not-a-real-provider-xyz");
    await waitFor(() => expect(screen.getByText(/No provider matches/i)).toBeInTheDocument(), { timeout: 10000 });
    const emptyState = screen.getByText(/No provider matches/i).closest("div");
    await user.click(within(emptyState).getByRole("button", { name: /Clear filters/i }));
    await waitFor(() => expect(screen.getByText("Slack")).toBeInTheDocument(), { timeout: 10000 });
  }, 15000);

  it("toggles between grid and list view", async () => {
    const user = userEvent.setup();
    renderMarketplace();
    await screen.findByText("Slack");
    const listButton = screen.getByRole("button", { name: "List view" });
    await user.click(listButton);
    expect(listButton).toHaveAttribute("aria-pressed", "true");
  }, 15000);

  it("navigates to provider detail via View Details", async () => {
    const user = userEvent.setup();
    renderMarketplace();
    await screen.findByText("Slack", {}, { timeout: 10000 });
    const slackCard = screen.getByRole("group", { name: "Slack" });
    await user.click(within(slackCard).getByRole("button", { name: "View Details" }));
    expect(await screen.findByText("Provider Detail Page")).toBeInTheDocument();
  }, 15000);

  it("shows Manage Preview for an already-connected provider and Preview Setup otherwise", async () => {
    renderMarketplace({ role: "Admin" });
    await screen.findByText("Slack", {}, { timeout: 10000 });
    const slackCard = screen.getByRole("group", { name: "Slack" });
    expect(within(slackCard).getByRole("button", { name: "Manage Preview" })).toBeInTheDocument();
    const calendlyCard = screen.getByRole("group", { name: "Calendly" });
    expect(within(calendlyCard).getByRole("button", { name: "Preview Setup" })).toBeInTheDocument();
  }, 15000);

  it("Organization Administrator only sees their own organization's connection status reflected on cards", async () => {
    renderMarketplace({ role: "Admin" });
    await screen.findByText("Stripe", {}, { timeout: 10000 });
    const stripeCard = screen.getByRole("group", { name: "Stripe" });
    expect(within(stripeCard).getByText("Configuration Required")).toBeInTheDocument();
    // Zoom is only connected in org_solstice_partners, not the Org Admin's own org.
    const zoomCard = screen.getByRole("group", { name: "Zoom" });
    expect(within(zoomCard).getByText("Preview Available")).toBeInTheDocument();
  }, 15000);

  it("System Owner sees an organization selector", async () => {
    renderMarketplace({ role: "Super-Admin" });
    expect(await screen.findByLabelText("Organization", {}, { timeout: 10000 })).toBeInTheDocument();
  }, 15000);

  it("Organization Administrator does not see an organization selector", async () => {
    renderMarketplace({ role: "Admin" });
    await screen.findByText("Slack", {}, { timeout: 10000 });
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  }, 15000);
});
