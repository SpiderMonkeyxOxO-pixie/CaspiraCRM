import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import IntegrationWebhooks from "./IntegrationWebhooks";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderWebhooks({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/webhooks"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/webhooks" element={<IntegrationWebhooks />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("IntegrationWebhooks", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title, and the required educational disclaimer", async () => {
    renderWebhooks();
    expect(await screen.findByText("Webhooks")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Webhook Preview" })).toBeInTheDocument();
    expect(screen.getByText(/educational frontend preview/i)).toBeInTheDocument();
    expect(screen.getByText(/Backend endpoint will be generated during production integration\./i)).toBeInTheDocument();
  });

  it("renders every required column", async () => {
    renderWebhooks();
    await screen.findByRole("table");
    ["Provider", "Preview Event", "Preview Endpoint", "Status", "Last Event", "Signature Verification", "Retry Policy", "Failures", "Organization"].forEach((col) => {
      expect(screen.getByRole("columnheader", { name: col })).toBeInTheDocument();
    });
  });

  it("never shows a real endpoint URL or webhook secret", async () => {
    renderWebhooks();
    await screen.findByRole("table");
    const bodyText = document.body.textContent;
    expect(bodyText).not.toMatch(/https?:\/\//);
    expect(bodyText).not.toMatch(/whsec_|secret_key/i);
  });

  it("shows realistic preview event names from the spec's list", async () => {
    renderWebhooks();
    await screen.findByRole("table");
    ["Email received", "Slack notification requested", "WhatsApp message delivered", "Payment succeeded", "Payment failed", "Invoice paid", "Document signed", "Meeting scheduled", "Meeting cancelled"].forEach((eventName) => {
      expect(screen.getByText(eventName)).toBeInTheDocument();
    });
    expect(screen.getAllByText("Calendar event updated").length).toBeGreaterThan(0);
  });

  it("System Owner sees an organization selector and column; Organization Administrator does not", async () => {
    renderWebhooks({ role: "Super-Admin" });
    expect(await screen.findByLabelText("Organization")).toBeInTheDocument();
    await screen.findByRole("table");
    expect(screen.getByRole("columnheader", { name: "Organization" })).toBeInTheDocument();
  });

  it("Organization Administrator only sees their own organization's webhook previews", async () => {
    renderWebhooks({ role: "Admin" });
    await screen.findByRole("table");
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Organization" })).not.toBeInTheDocument();
    expect(screen.queryByText("Meeting scheduled")).not.toBeInTheDocument(); // seeded only for org_solstice_partners
  });

  it("System Owner can filter by organization", async () => {
    const user = userEvent.setup();
    renderWebhooks({ role: "Super-Admin" });
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("Organization"), "org_solstice_partners");
    await waitFor(() => expect(screen.getByText("Meeting scheduled")).toBeInTheDocument(), { timeout: 5000 });
  });

  it("flags webhook previews with failures", async () => {
    renderWebhooks({ role: "Super-Admin" });
    await screen.findByRole("table");
    expect(screen.getByText("3")).toBeInTheDocument(); // WhatsApp Business seeded with 3 failures
  });
});
