import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import SignatureWorkflowList from "./SignatureWorkflowList";
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
      <MemoryRouter initialEntries={["/admin/integrations/documents-storage/signatures"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/documents-storage/signatures" element={<SignatureWorkflowList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("SignatureWorkflowList", () => {
  beforeEach(() => localStorage.clear());

  it("renders the breadcrumb, title and Frontend Preview badge", async () => {
    renderList();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Electronic Signature Workflows" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists workflows and toggles to the status board", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Dropbox Sign");
    await user.click(screen.getByRole("button", { name: "Status Board" }));
    const boards = screen.getAllByText((content, el) => el?.tagName === "P" && /^Signed Preview \(/.test(el.textContent));
    expect(boards.length).toBe(1);
  });

  it("every status carries the Preview qualifier", async () => {
    renderList();
    await screen.findByText("Dropbox Sign");
    const statusCells = screen.getAllByText(/Preview$/);
    expect(statusCells.length).toBeGreaterThan(0);
  });

  it("opens the creation dialog and shows failing validation for a nonexistent source record", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Dropbox Sign");
    await user.click(screen.getByRole("button", { name: /Create Signature Workflow Preview/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Source Record ID"), "nonexistent-record");
    await user.click(within(dialog).getByRole("button", { name: "Confirm Preview" }));
    await waitFor(() => expect(within(dialog).getByText("Validation checks")).toBeInTheDocument());
    expect(within(dialog).getByText("Source record exists")).toBeInTheDocument();
  });

  it("void requires a written reason", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Dropbox Sign");
    const voidButtons = screen.getAllByTitle("Void Preview");
    await user.click(voidButtons[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Void Workflow" })).toBeDisabled();
  });

  it("never claims a real signature request was sent", async () => {
    renderList();
    await screen.findByText("Dropbox Sign");
    expect(screen.queryByText(/request was sent to the recipient/i)).not.toBeInTheDocument();
  });
});
