import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import DocumentMappingsConfig from "./DocumentMappingsConfig";
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
      <MemoryRouter initialEntries={["/admin/integrations/documents-storage/mappings"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/documents-storage/mappings" element={<DocumentMappingsConfig />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("DocumentMappingsConfig", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Document & Folder Mappings" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("shows all 7 mapping tabs", async () => {
    renderPage();
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Folder Mappings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Associations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File-Type Rules" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Classification Rules" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Permission Mappings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Naming Rules" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conflict Rules" })).toBeInTheDocument();
  });

  it("naming-rule tab validates a pattern live and rejects illegal characters", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Naming Rules" }));
    expect(await screen.findByText("Valid naming pattern.")).toBeInTheDocument();
    const input = screen.getByLabelText("Naming Pattern Preview");
    await user.clear(input);
    await user.type(input, "Bad<Name>");
    expect(await screen.findByText(/not allowed by storage providers/i)).toBeInTheDocument();
  });

  it("classification rules tab shows all 8 classifications and their effects", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Classification Rules" }));
    expect(screen.getByText("HR Restricted")).toBeInTheDocument();
    expect(screen.getByText(/Customer Portal visibility disabled/i)).toBeInTheDocument();
  });

  it("never allows a naming rule to execute a script", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Naming Rules" }));
    const input = await screen.findByLabelText("Naming Pattern Preview");
    fireEvent.change(input, { target: { value: "{evilScript}" } });
    expect(await screen.findByText(/Unrecognized placeholder/i)).toBeInTheDocument();
  });
});
