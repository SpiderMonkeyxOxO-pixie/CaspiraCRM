import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import RetentionPolicyConfig from "./RetentionPolicyConfig";
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
      <MemoryRouter initialEntries={["/admin/integrations/documents-storage/retention"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/documents-storage/retention" element={<RetentionPolicyConfig />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("RetentionPolicyConfig", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Document Retention & Legal Holds" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists retention policies including a Policy Missing state", async () => {
    renderPage();
    expect(await screen.findByText("Policy Missing")).toBeInTheDocument();
    expect(screen.getByText("Review Due")).toBeInTheDocument();
  });

  it("legal-hold removal enforces separation of duties and requires a written reason", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Policy Missing");
    await user.click(screen.getByRole("button", { name: "Remove Hold" }));
    const dialog = await screen.findByRole("dialog");
    const removeButton = within(dialog).getByRole("button", { name: "Remove Hold" });
    expect(removeButton).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Requester"), "Dominic Wuckert");
    await user.selectOptions(within(dialog).getByLabelText("Approver"), "Dominic Wuckert");
    expect(within(dialog).getByText(/separation of duties/i)).toBeInTheDocument();
    expect(removeButton).toBeDisabled();
  });

  it("never claims a real document was deleted or archived", async () => {
    renderPage();
    await screen.findByText("Policy Missing");
    expect(screen.queryByText(/document was deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/document was archived/i)).not.toBeInTheDocument();
  });
});
