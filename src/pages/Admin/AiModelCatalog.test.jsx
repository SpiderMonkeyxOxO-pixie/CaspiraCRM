import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import AiModelCatalog from "./AiModelCatalog";
import authReducer from "../../redux/authSlice";
import integrationsReducer from "../../redux/admin/integrationsSlice";

function renderCatalog({ role = "Super-Admin" } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/admin/integrations/ai-providers/models"]}>
        <ErrorBoundary><AiModelCatalog /></ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
}

describe("AiModelCatalog", () => {
  beforeEach(() => localStorage.clear());

  it("renders the title and Frontend Preview badge", async () => {
    renderCatalog();
    expect(await screen.findByRole("heading", { name: "Model Catalog" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Preview")).toBeInTheDocument();
  });

  it("lists all 8 canonical model aliases", async () => {
    renderCatalog();
    await screen.findAllByTestId("model-alias");
    const aliases = screen.getAllByTestId("model-alias").map((el) => el.textContent);
    expect(aliases).toEqual(["Fast", "Balanced", "Advanced", "Long Context", "Structured Extraction", "Vision", "Embedding", "Local Private"]);
  });

  it("never states an exact price", async () => {
    renderCatalog();
    await screen.findAllByTestId("model-alias");
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it("references providers by alias, never a hard-coded model name", async () => {
    renderCatalog();
    await screen.findAllByTestId("model-alias");
    expect(screen.queryByText(/gpt-4|claude-3|gemini-1/i)).not.toBeInTheDocument();
  });
});
