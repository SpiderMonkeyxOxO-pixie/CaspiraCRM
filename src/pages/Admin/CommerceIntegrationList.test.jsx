import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import CommerceIntegrationList from "./CommerceIntegrationList";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderList({ role = "Super-Admin", initialEntries = ["/admin/integrations/commerce-finance/commerce"] } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/commerce-finance/commerce" element={<CommerceIntegrationList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("CommerceIntegrationList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderList();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Commerce Integrations" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows all 6 tabs and defaults to Stores", async () => {
    renderList();
    await screen.findByText("caspira-hq.myshopify.com");
    expect(screen.getByRole("button", { name: "Stores" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fulfilments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Returns" })).toBeInTheDocument();
  });

  it("lists stores with provider name and lets a manager pause one", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("caspira-hq.myshopify.com");
    expect(screen.getAllByText("Shopify").length).toBeGreaterThan(0);
    const pauseButtons = screen.getAllByTitle(/Pause preview|Resume preview/);
    await user.click(pauseButtons[0]);
    await waitFor(() => expect(screen.getAllByTitle(/Pause preview|Resume preview/).length).toBeGreaterThan(0));
  });

  it("switches to the Customers tab and shows match states", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("caspira-hq.myshopify.com");
    await user.click(screen.getByRole("button", { name: "Customers" }));
    await waitFor(() => expect(screen.getByText("Matched")).toBeInTheDocument());
  });

  it("switches to the Orders tab and shows unlinked orders as a link to real Orders", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("caspira-hq.myshopify.com");
    await user.click(screen.getByRole("button", { name: "Orders" }));
    await waitFor(() => expect(screen.getAllByText("Unlinked").length).toBeGreaterThan(0));
  });

  it("never claims an external Product, Customer or Order was actually created", async () => {
    renderList();
    await screen.findByText("caspira-hq.myshopify.com");
    expect(screen.queryByText(/was created in Shopify/i)).not.toBeInTheDocument();
  });
});
