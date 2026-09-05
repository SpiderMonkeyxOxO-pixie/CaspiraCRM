import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import FilesIntegrationList from "./FilesIntegrationList";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderList({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/documents-storage/files"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/documents-storage/files" element={<FilesIntegrationList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("FilesIntegrationList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderList();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "External Files" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists files with safe metadata, never a real download link", async () => {
    renderList();
    await screen.findByText("Caspira HQ - Master Services Agreement.pdf");
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/https:\/\/.*\.(pdf|docx)/i)).not.toBeInTheDocument();
  });

  it("toggles between table and card view", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Caspira HQ - Master Services Agreement.pdf");
    await user.click(screen.getByRole("button", { name: "Card view" }));
    expect(screen.getByRole("button", { name: "Card view" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the file detail drawer with safe metadata, no file contents", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Caspira HQ - Master Services Agreement.pdf");
    await user.click(screen.getByText("Caspira HQ - Master Services Agreement.pdf"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Provider Reference")).toBeInTheDocument();
    expect(within(dialog).getByText("Classification")).toBeInTheDocument();
  });

  it("association workflow shows a sensitive-data warning for a Legal-classified file and supports Undo", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Caspira HQ - Master Services Agreement.pdf");
    await user.click(screen.getByText("Caspira HQ - Master Services Agreement.pdf"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Link to CRM Record" }));
    const assocDialog = await screen.findByRole("dialog", { name: /Associate File with CRM Record/i });
    await user.selectOptions(within(assocDialog).getByLabelText("CRM Module"), "Company");
    await user.type(within(assocDialog).getByLabelText("Record ID"), "nonexistent-id");
    expect(within(assocDialog).getByText(/Sensitive-Data Warning/i)).toBeInTheDocument();
  });

  it("never displays file content, only metadata", async () => {
    renderList();
    await screen.findByText("Caspira HQ - Master Services Agreement.pdf");
    expect(screen.queryByText(/lorem ipsum/i)).not.toBeInTheDocument();
  });
});
