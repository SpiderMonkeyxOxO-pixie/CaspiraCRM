import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiProviderConnectionList from "./AiProviderConnectionList";
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
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers/providers"]}>
        <ErrorBoundary>
          <Routes>
            <Route path="/admin/integrations/ai-providers/providers" element={<AiProviderConnectionList />} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...utils };
}

describe("AiProviderConnectionList", () => {
  beforeEach(() => localStorage.clear());

  it("renders all 5 provider preview cards", async () => {
    renderList();
    expect(await screen.findByText("Anthropic Claude")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Google Gemini")).toBeInTheDocument();
    expect(screen.getByText("Azure OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Ollama (Local Models)")).toBeInTheDocument();
  });

  it("shows the seeded connection states, never a plain Connected label", async () => {
    renderList();
    await screen.findByText("Anthropic Claude");
    await waitFor(() => expect(screen.getByText("Preview Configured")).toBeInTheDocument());
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("opens the Preview Provider Setup wizard and shows the connection model choice", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole("button", { name: "Preview Provider Setup" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText(/Organization-Managed/).length).toBeGreaterThan(0);
    expect(screen.getByText("Future Platform-Managed Option")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Future Platform-Managed Option/ })).toBeDisabled();
  });

  it("completing the wizard shows the no-provider-contacted preview notice", async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole("button", { name: "Preview Provider Setup" }));
    expect(await screen.findByText(/No provider account was contacted and no credential was stored/i)).toBeInTheDocument();
  });

  it("pausing a configured connection preview opens a confirmation dialog", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Preview Configured");
    await user.click(screen.getByTitle("Pause Preview"));
    expect(await screen.findByRole("heading", { name: "Pause Provider Connection Preview" })).toBeInTheDocument();
  });
});
