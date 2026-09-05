import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SalesFormsIntegration from "./SalesFormsIntegration";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderForms({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/sales-marketing/forms"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/sales-marketing" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/sales-marketing/forms" element={<SalesFormsIntegration />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SalesFormsIntegration", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderForms();
    expect(await screen.findByRole("heading", { name: "Forms Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists form connections and expands to show field mappings", async () => {
    const user = userEvent.setup();
    renderForms();
    const row = await screen.findByText("Contact Sales");
    await user.click(row.closest("tr"));
    expect(await screen.findByText("work_email")).toBeInTheDocument();
  });

  it("shows a clear reason when a required field is still unmapped, ahead of clicking Enable Form", async () => {
    const user = userEvent.setup();
    renderForms();
    const row = await screen.findByText("Event Registration");
    await user.click(row.closest("tr"));
    expect(await screen.findByText(/Required CRM field\(s\) not yet mapped: companyName/i)).toBeInTheDocument();
    // The button stays present (Enable Form's own real error surfaces via
    // toast on click, per enableFormConnection's actual signature) rather
    // than being silently hidden.
    expect(screen.getByRole("button", { name: "Enable Form" })).toBeInTheDocument();
  });

  it("a role with no forms_integrations grant (Standard Employee) cannot view Forms", async () => {
    renderForms({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Forms Integrations/i)).toBeInTheDocument());
  });
});
