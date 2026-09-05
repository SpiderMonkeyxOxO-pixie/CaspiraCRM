import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundary";
import PreviewConnectionWizard from "./PreviewConnectionWizard";
import authReducer from "../../redux/authSlice";
import integrationsReducer, { selectIntegrations } from "../../redux/admin/integrationsSlice";
import { findProvider } from "../../Helpers/mockIntegrationsData";

function renderWizard({ role = "Admin", providerKey = "calendly", organizations, onClose = () => {}, onCompleted = () => {} } = {}) {
  localStorage.setItem("role", role);
  localStorage.setItem("isLoggedIn", "true");
  const store = configureStore({
    reducer: { auth: authReducer, integrations: integrationsReducer },
    preloadedState: { auth: { role, isLoggedIn: true, data: {} } },
  });
  const provider = findProvider(providerKey);
  const orgs = organizations || [
    { id: "org_caspira_hq", name: "Caspira HQ" },
    { id: "org_nimbus_retail", name: "Nimbus Retail Group" },
    { id: "org_solstice_partners", name: "Solstice Partners" },
  ];
  const utils = render(
    <Provider store={store}>
      <MemoryRouter>
        <ErrorBoundary>
          <PreviewConnectionWizard provider={provider} actingRole={role} organizations={orgs} onClose={onClose} onCompleted={onCompleted} />
        </ErrorBoundary>
      </MemoryRouter>
    </Provider>
  );
  return { store, provider, ...utils };
}

async function completeUpToSecurityReview(user) {
  for (let i = 0; i < 8; i += 1) {
     
    await user.click(screen.getByRole("button", { name: "Continue" }));
  }
}

describe("PreviewConnectionWizard", () => {
  beforeEach(() => localStorage.clear());

  it("renders all 10 steps in the stepper", async () => {
    renderWizard();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    ["Provider Overview", "Organization", "Capabilities", "Permissions", "Data Scope", "Sync Direction", "Field Mapping", "Notifications", "Security Review", "Confirmation"].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it("shows the Frontend Connection Preview disclosure on the first step", () => {
    renderWizard();
    expect(screen.getByText("Frontend Connection Preview")).toBeInTheDocument();
    expect(screen.getByText(/simulated using frontend fixture data/i)).toBeInTheDocument();
  });

  it("Organization Administrator sees a fixed organization, System Owner sees a selector", async () => {
    renderWizard({ role: "Admin" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Caspira HQ")).toBeInTheDocument();
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
  });

  it("System Owner must select an organization before continuing", async () => {
    const user = userEvent.setup();
    renderWizard({ role: "Super-Admin" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Organization"), "org_caspira_hq");
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
  });

  it("requires at least one capability selected to continue", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Organization
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Capabilities
    const checkboxes = screen.getAllByRole("checkbox");
    for (const box of checkboxes) {
       
      await user.click(box);
    }
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("shows required permissions derived from selected capabilities", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Continue" })); // Organization
    await user.click(screen.getByRole("button", { name: "Continue" })); // Capabilities
    await user.click(screen.getByRole("button", { name: "Continue" })); // Permissions
    expect(screen.getAllByText(/integrations\./).length).toBeGreaterThan(0);
  });

  it("Security Review step lists required disclosures and gates Continue on acknowledgement", async () => {
    const user = userEvent.setup();
    renderWizard();
    await completeUpToSecurityReview(user);
    expect(screen.getByText(/Least-privilege permissions/i)).toBeInTheDocument();
    expect(screen.getByText(/Organization isolation/i)).toBeInTheDocument();
    expect(screen.getByText(/Data leaving the CRM/i)).toBeInTheDocument();
    expect(screen.getByText(/Data entering the CRM/i)).toBeInTheDocument();
    expect(screen.getByText(/No credential is stored in this browser/i)).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();
    await user.click(screen.getByText(/I have reviewed the security and access implications/i));
    expect(continueButton).not.toBeDisabled();
  });

  it("never exposes a token, API key, client secret, or full card number anywhere in the wizard", async () => {
    const user = userEvent.setup();
    renderWizard({ providerKey: "stripe" });
    await completeUpToSecurityReview(user);
    const text = document.body.textContent;
    expect(text).not.toMatch(/sk_live|sk_test|4242 4242 4242 4242/);
  });

  it("the final button is labeled Complete Preview Connection, never Connect Account", async () => {
    const user = userEvent.setup();
    renderWizard();
    await completeUpToSecurityReview(user);
    await user.click(screen.getByText(/I have reviewed the security and access implications/i));
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Confirmation
    expect(screen.getByRole("button", { name: "Complete Preview Connection" })).toBeInTheDocument();
    expect(screen.queryByText("Connect Account")).not.toBeInTheDocument();
  });

  it("completing the wizard shows the required completion message and never claims a real provider was contacted", async () => {
    const user = userEvent.setup();
    const { store } = renderWizard({ providerKey: "xero" });
    await completeUpToSecurityReview(user);
    await user.click(screen.getByText(/I have reviewed the security and access implications/i));
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Confirmation
    await user.click(screen.getByRole("button", { name: "Complete Preview Connection" }));

    await waitFor(() => expect(screen.getByText("Preview connection created. No external provider was contacted.")).toBeInTheDocument(), { timeout: 5000 });
    const created = selectIntegrations(store.getState()).connections.find((c) => c.providerKey === "xero" && c.organizationId === "org_caspira_hq");
    expect(created).toBeTruthy();
    expect(created.status).toBe("Preview Connected");
  }, 15000);

  it("clears the session draft once a connection is completed", async () => {
    const user = userEvent.setup();
    const { store } = renderWizard({ providerKey: "zapier" });
    await completeUpToSecurityReview(user);
    await user.click(screen.getByText(/I have reviewed the security and access implications/i));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Complete Preview Connection" }));
    await waitFor(() => expect(selectIntegrations(store.getState()).wizardDraft).toBeNull(), { timeout: 5000 });
  }, 15000);

  it("preserves entered settings in the session draft while the wizard is open", async () => {
    const user = userEvent.setup();
    const { store } = renderWizard({ providerKey: "make" });
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Organization
    await waitFor(() => expect(selectIntegrations(store.getState()).wizardDraft?.providerKey).toBe("make"), { timeout: 5000 });
  });

  it("Cancel calls onClose without creating a connection", async () => {
    const user = userEvent.setup();
    let closed = false;
    const { store } = renderWizard({ providerKey: "twilio", onClose: () => { closed = true; } });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closed).toBe(true);
    expect(selectIntegrations(store.getState()).connections.some((c) => c.providerKey === "twilio")).toBe(false);
  });

  it("Auditor/Checker cannot complete a preview connection even if the wizard is somehow reached (defense in depth)", async () => {
    const user = userEvent.setup();
    renderWizard({ role: "Checker" });
    await completeUpToSecurityReview(user);
    await user.click(screen.getByText(/I have reviewed the security and access implications/i));
    await user.click(screen.getByRole("button", { name: "Continue" })); // -> Confirmation
    expect(screen.getByRole("button", { name: "Complete Preview Connection" })).toBeDisabled();
  });
});
