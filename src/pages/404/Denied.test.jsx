import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import authReducer from "../../redux/authSlice";
import Denied from "./Denied";

function renderDenied(role) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { role, isLoggedIn: !!role, data: {} } },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/denied"]}>
        <Routes>
          <Route path="/denied" element={<Denied />} />
          <Route path="/crm/dashboard" element={<div>CRM Dashboard Page</div>} />
          <Route path="/finance/dashboard" element={<div>Finance Dashboard Page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

// Regression test for a real bug: "Go to Dashboard" used to hardcode routes
// (/dashboard, /admin, /user, /checker, /team) that don't exist anywhere in
// App.jsx's route tree, so clicking it landed on the catch-all route, which
// redirects straight back to /denied — a dead-end loop no role could escape.
describe("Denied — 'Go to Dashboard' routes to a real, role-appropriate page", () => {
  it("renders the Access Denied message", () => {
    renderDenied("User");
    expect(screen.getByText("403")).toBeInTheDocument();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });

  it.each([
    ["Super-Admin", "CRM Dashboard Page"],
    ["Admin", "CRM Dashboard Page"],
    ["Team-Leader", "CRM Dashboard Page"],
    ["User", "CRM Dashboard Page"],
    ["Checker", "Finance Dashboard Page"],
  ])("role %s lands on a real page after clicking Go to Dashboard", async (role, expectedText) => {
    const user = userEvent.setup();
    renderDenied(role);
    await user.click(screen.getByText("Go to Dashboard"));
    expect(await screen.findByText(expectedText)).toBeInTheDocument();
  });
});
