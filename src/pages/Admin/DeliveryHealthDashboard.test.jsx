import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import DeliveryHealthDashboard from "./DeliveryHealthDashboard";
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
      <MemoryRouter initialEntries={["/admin/integrations/projects-development/delivery-health"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/projects-development/delivery-health" element={<DeliveryHealthDashboard />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("DeliveryHealthDashboard", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delivery Health" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("renders all 19 named indicators, each with a why and calculation", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Calculation")).toHaveLength(19), { timeout: 5000 });
    expect(screen.getAllByText("Fields Used")).toHaveLength(19);
  });

  it("detected indicators show a required approver", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Calculation")).toHaveLength(19), { timeout: 5000 });
    const approverLabels = screen.queryAllByText("Required Approver");
    expect(approverLabels.length).toBeGreaterThan(0);
  });

  it("filters to only detected indicators when the checkbox is toggled", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Calculation")).toHaveLength(19), { timeout: 5000 });
    await user.click(screen.getByLabelText("Show only detected indicators"));
    const after = screen.getAllByText("Calculation").length;
    expect(after).toBeLessThan(19);
    expect(after).toBeGreaterThan(0);
  });

  it("never displays a single unexplained overall score", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Calculation")).toHaveLength(19), { timeout: 5000 });
    expect(screen.queryByText(/^Health Score:/i)).not.toBeInTheDocument();
  });
});
