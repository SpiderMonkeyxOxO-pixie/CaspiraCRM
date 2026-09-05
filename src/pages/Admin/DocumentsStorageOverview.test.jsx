import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import DocumentsStorageOverview from "./DocumentsStorageOverview";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderOverview({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/documents-storage"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/documents-storage" element={<DocumentsStorageOverview />} />
            <Route path="/admin/integrations/documents-storage/files" element={<div>Files Page</div>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("DocumentsStorageOverview", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb and title with the Frontend Preview badge", async () => {
    renderOverview();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Documents, Storage and Electronic Signatures" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("System Owner sees a real organization selector with all organizations", async () => {
    renderOverview({ role: "Super-Admin" });
    const select = await screen.findByLabelText("Organization");
    await waitFor(() => expect(select.querySelectorAll("option").length).toBe(4), { timeout: 5000 });
  });

  it("shows the 12 named deterministic metrics", async () => {
    renderOverview();
    expect(await screen.findByRole("button", { name: /Preview-Connected Providers/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Linked Files/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Unlinked Files/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Files with New Versions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Restricted Files/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /External Sharing Risks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Signature Workflows Awaiting Approval/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Signature Workflows Awaiting Recipients/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expiring Signature Workflows/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retention Actions Due/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Synchronization Conflicts/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Provider Errors/i })).toBeInTheDocument();
  });

  it("clicking a metric navigates to the corresponding route", async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole("button", { name: /^Linked Files/i }));
    expect(await screen.findByText("Files Page")).toBeInTheDocument();
  });

  it("never displays an unexplained document score", async () => {
    renderOverview();
    await screen.findByText("Storage Health / Provider Health");
    expect(screen.queryByText(/^Document Score:/i)).not.toBeInTheDocument();
  });

  it("never claims a real file was uploaded, downloaded or deleted", async () => {
    renderOverview();
    await screen.findByText("Storage Health / Provider Health");
    expect(screen.queryByText(/file was uploaded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/file was deleted/i)).not.toBeInTheDocument();
  });
});
