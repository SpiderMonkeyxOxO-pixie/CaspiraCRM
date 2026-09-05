import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SalesAttribution from "./SalesAttribution";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderAttribution({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/sales-marketing/attribution"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/sales-marketing" element={<div>Overview Page</div>} />
            <Route path="/admin/integrations/sales-marketing/attribution" element={<SalesAttribution />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SalesAttribution", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderAttribution();
    expect(await screen.findByRole("heading", { name: "Attribution" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists campaigns and shows the real ROI-unavailable message for campaigns with no verified spend", async () => {
    renderAttribution();
    expect(await screen.findByText("Q3 Newsletter Preview")).toBeInTheDocument();
    expect(screen.getAllByText(/ROI unavailable/i).length).toBeGreaterThan(0);
  });

  it("expands a campaign row to show touchpoint detail", async () => {
    const user = userEvent.setup();
    renderAttribution();
    const row = await screen.findByText("Q3 Newsletter Preview");
    await user.click(row.closest("tr"));
    expect(await screen.findByText(/Provider Campaign ID:/i)).toBeInTheDocument();
  });

  it("shows the Conversion Mapping panel as disclosed display-only, never an editor", async () => {
    renderAttribution();
    expect(await screen.findByText("Conversion Mapping")).toBeInTheDocument();
    expect(screen.getByText(/no mapping-rule editor in this preview/i)).toBeInTheDocument();
  });

  it("a role with no attribution grant (Standard Employee) cannot view Attribution", async () => {
    renderAttribution({ role: "User" });
    await waitFor(() => expect(screen.getByText(/You do not have permission to view Attribution/i)).toBeInTheDocument());
  });
});
