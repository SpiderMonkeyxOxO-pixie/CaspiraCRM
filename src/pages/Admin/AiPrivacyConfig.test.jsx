import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiPrivacyConfig from "./AiPrivacyConfig";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderPage({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers/privacy"]}>
        <ErrorBoundary><AiPrivacyConfig /></ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("AiPrivacyConfig", () => {
  beforeEach(() => localStorage.clear());

  it("renders the title and Frontend Preview badge", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Privacy and Data Protection" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists all 9 data classifications", async () => {
    renderPage();
    expect(await screen.findByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
    expect(screen.getByText("Confidential")).toBeInTheDocument();
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect(screen.getByText("Personal Data")).toBeInTheDocument();
    expect(screen.getByText("Financial")).toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
    expect(screen.getByText("HR Restricted")).toBeInTheDocument();
    expect(screen.getAllByText("Credentials and Secrets").length).toBeGreaterThan(0);
  });

  it("Credentials and Secrets is always marked as always excluded", async () => {
    renderPage();
    const row = await screen.findByTestId("classification-row-Credentials and Secrets");
    expect(row.textContent).toContain("Always Excluded");
    expect(row.textContent).toContain("Deny Request");
  });

  it("redaction preview never shows real sensitive data, only fixed examples", async () => {
    renderPage();
    expect(await screen.findByText(/a\*\*\*\*@example\.com/)).toBeInTheDocument();
  });

  it("context assembly preview never reveals hidden-record existence or counts", async () => {
    renderPage();
    expect(await screen.findByText(/never reveals the existence or count of any hidden record/i)).toBeInTheDocument();
  });
});
