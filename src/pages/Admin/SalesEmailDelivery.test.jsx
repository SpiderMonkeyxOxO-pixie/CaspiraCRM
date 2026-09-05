import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SalesEmailDelivery from "./SalesEmailDelivery";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderEmailDelivery({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/sales-marketing/email-delivery"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/sales-marketing" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/sales-marketing/email-delivery" element={<SalesEmailDelivery />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SalesEmailDelivery", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderEmailDelivery();
    expect(await screen.findByRole("heading", { name: "Email Delivery" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows live-computed delivery/bounce rate metrics and lists events", async () => {
    renderEmailDelivery();
    await waitFor(() => expect(screen.getByText("Delivery Rate")).toBeInTheDocument());
    expect(screen.getByText("Bounce Rate")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/sendgrid|SendGrid/i).length).toBeGreaterThan(0));
  });

  it("filters by transactional/marketing purpose tabs", async () => {
    const user = userEvent.setup();
    renderEmailDelivery();
    await waitFor(() => expect(screen.getByRole("button", { name: "Transactional" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Marketing" }));
    await waitFor(() => expect(screen.getAllByText("marketing").length).toBeGreaterThan(0));
  });

  it("only offers Retry on Failed/Deferred/Bounced events", async () => {
    renderEmailDelivery();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Retry/i }).length).toBeGreaterThan(0));
    const rows = screen.getAllByRole("row").slice(1);
    const deliveredRow = rows.find((r) => r.textContent.includes("Delivered"));
    expect(deliveredRow).toBeTruthy();
    expect(deliveredRow.textContent).not.toContain("Retry");
  });

  it("a role with no email_delivery grant (Standard Employee) cannot view Email Delivery", async () => {
    renderEmailDelivery({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Email Delivery/i)).toBeInTheDocument());
  });
});
