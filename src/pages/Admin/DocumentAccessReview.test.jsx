import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import DocumentAccessReview from "./DocumentAccessReview";
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
      <MemoryRouter initialEntries={["/admin/integrations/documents-storage/access-review"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/documents-storage/access-review" element={<DocumentAccessReview />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("DocumentAccessReview", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Document Access Review" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("detects the seeded public-sharing and external-collaborator risks with full explanations", async () => {
    renderPage();
    expect(await screen.findByText("Public sharing link")).toBeInTheDocument();
    expect(screen.getByText("External collaborator")).toBeInTheDocument();
    expect(screen.getAllByText("Required Approver").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Supporting Permission").length).toBeGreaterThan(0);
  });

  it("Organization Administrator sees a fixed organization label instead of a selector", async () => {
    renderPage({ role: "Admin" });
    await screen.findByText(/Preview Available|Public sharing link|No access risks detected/i);
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  });

  it("suggested actions remain previews, never claiming access was actually revoked", async () => {
    renderPage();
    await screen.findByText("Public sharing link");
    expect(screen.queryByText(/access was revoked/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Suggested Action (Preview Only)").length).toBeGreaterThan(0);
  });
});
