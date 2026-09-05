import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SignatureTemplatesList from "./SignatureTemplatesList";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderPage({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/documents-storage/templates"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/documents-storage/templates" element={<SignatureTemplatesList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SignatureTemplatesList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Signature Templates" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists templates and expands field mappings, restricting sensitive fields for a standard role", async () => {
    const user = userEvent.setup();
    renderPage({ role: "User" });
    await screen.findByText("Quote Acceptance");
    await user.click(screen.getByText("Service Contract"));
    expect(await screen.findByText("Related CRM Module:")).toBeInTheDocument();
    expect(screen.getByText("Restricted")).toBeInTheDocument();
  });

  it("System Owner can see the restricted field label unmasked", async () => {
    const user = userEvent.setup();
    renderPage({ role: "Super-Admin" });
    await screen.findByText("Service Contract");
    await user.click(screen.getByText("Service Contract"));
    expect(await screen.findByText("Signatory Name")).toBeInTheDocument();
  });

  it("never builds an unrestricted legal-document generator — only fixed template types appear", async () => {
    renderPage();
    await screen.findByText("Quote Acceptance");
    expect(screen.queryByRole("button", { name: /new template/i })).not.toBeInTheDocument();
  });
});
