import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import authReducer from "../redux/authSlice";
import { guideFor } from "./registry";
import { GuideProvider, useGuide } from "./GuideContext";
import HelpPanel from "./HelpPanel";
import Tour from "./Tour";
import TourPrompt from "./TourPrompt";

const GUIDES = [
  { path: "/crm/leads/:id", title: "Lead", purpose: "One lead." },
  { path: "/crm/leads", title: "Leads", purpose: "All leads.", sections: [{ heading: "Filters", body: "Narrow the list." }], tour: [
    { target: "create", title: "Add a lead", body: "Start here." },
    { target: "missing-on-page", title: "Centered step", body: "No element, shown in the middle." },
  ] },
  { path: "/crm/*", title: "CRM", purpose: "Customers and deals." },
];

describe("guideFor", () => {
  it("prefers the exact page, then the module fallback", () => {
    expect(guideFor("/crm/leads", GUIDES).title).toBe("Leads");
    expect(guideFor("/crm/leads/abc", GUIDES).title).toBe("Lead");
    expect(guideFor("/crm/pipeline", GUIDES).title).toBe("CRM");
    expect(guideFor("/unknown", GUIDES)).toBeNull();
  });
  it("has a module guide for every signed-in area", () => {
    for (const p of ["/crm/x", "/sales/x", "/support/x", "/projects/x", "/marketing/x", "/finance/x", "/ai/x", "/analytics/x", "/reports/x", "/admin/x", "/platform", "/settings"]) {
      expect(guideFor(p), p).not.toBeNull();
    }
  });
});

function Harness({ children }) {
  const g = useGuide();
  return <>{children}<button type="button" onClick={g.openPanel}>open help</button></>;
}

function renderAt(path) {
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: { role: "User", isLoggedIn: true, data: { _id: "u1" } } } });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <GuideProvider><Harness><button type="button" data-tour="create">Create lead</button></Harness><HelpPanel /><Tour /><TourPrompt /></GuideProvider>
      </MemoryRouter>
    </Provider>
  );
}

describe("guide UI", () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem("crm.guide.u1", JSON.stringify({ seen: { __welcome: "2026-09-26" } })); });

  it("opens help for a module page without its own guide", () => {
    renderAt("/admin/no-such-page");
    fireEvent.click(screen.getByText("open help"));
    expect(screen.getByRole("dialog", { name: "Administration" })).toBeInTheDocument();
    expect(screen.queryByText(/Take the tour/)).not.toBeInTheDocument();
  });
});

function renderWithGuides(path) {
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: { role: "User", isLoggedIn: true, data: { _id: "u1" } } } });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <GuideProvider guides={GUIDES}><Harness><button type="button" data-tour="create">Create lead</button></Harness><HelpPanel /><Tour /><TourPrompt /></GuideProvider>
      </MemoryRouter>
    </Provider>
  );
}

describe("tours", () => {
  // The welcome tour has been seen, so page tours are offered.
  beforeEach(() => { localStorage.clear(); localStorage.setItem("crm.guide.u1", JSON.stringify({ seen: { __welcome: "2026-09-26" } })); });

  it("offers the tour on the first visit, runs every step and doesn't offer it again", () => {
    const { unmount } = renderWithGuides("/crm/leads");
    expect(screen.getByText("New to Leads?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start the tour" }));
    expect(screen.getByText("Add a lead")).toBeInTheDocument();
    expect(screen.getByText("Leads · step 1 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Centered step")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Centered step")).not.toBeInTheDocument();
    unmount();
    renderWithGuides("/crm/leads");
    expect(screen.queryByText("New to Leads?")).not.toBeInTheDocument();
  });

  it("explains the page in the help panel and starts the tour from there", () => {
    renderWithGuides("/crm/leads");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    fireEvent.click(screen.getByText("open help"));
    expect(screen.getByText("All leads.")).toBeInTheDocument();
    expect(screen.getByText("Narrow the list.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Take the tour \(2 steps\)/ }));
    expect(screen.getByText("Add a lead")).toBeInTheDocument();
  });

  it("lets the user switch the first-visit prompts off", () => {
    renderWithGuides("/crm/leads");
    fireEvent.click(screen.getByText("open help"));
    fireEvent.click(screen.getByLabelText(/Offer tours on pages/));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("New to Leads?")).not.toBeInTheDocument();
  });
});

describe("guide content", () => {
  it("every tour step points at a data-tour element that exists on some page", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { allGuides } = await import("./registry");
    const files = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith(".jsx") && !p.endsWith(".test.jsx")) files.push(p); } };
    walk(path.resolve("src/pages"));
    const source = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const missing = allGuides().flatMap((g) => (g.tour || []).filter((s) => s.target && !source.includes(`tour="${s.target}"`)).map((s) => `${g.path} → ${s.target}`));
    expect(missing).toEqual([]);
  });

  it("every guide has a title and a purpose, and no two guides share a path", async () => {
    const { allGuides } = await import("./registry");
    const paths = allGuides().map((g) => g.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const g of allGuides()) { expect(g.title, g.path).toBeTruthy(); expect(g.purpose, g.path).toBeTruthy(); }
  });
});

describe("welcome tour and user guide", () => {
  beforeEach(() => localStorage.clear());

  it("starts the welcome tour by itself on the first sign-in, and only once", async () => {
    const { unmount } = renderWithGuides("/crm/leads");
    expect(await screen.findByText("Welcome!", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText("New to Leads?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.getByText("New to Leads?")).toBeInTheDocument();
    unmount();
    renderWithGuides("/crm/leads");
    await new Promise((r) => setTimeout(r, 1000));
    expect(screen.queryByText("Welcome!")).not.toBeInTheDocument();
  });

  it("explains how the system connects and links to the pages", () => {
    localStorage.setItem("crm.guide.u1", JSON.stringify({ seen: { __welcome: "x" } }));
    renderWithGuides("/crm/leads");
    fireEvent.click(screen.getByText("open help"));
    fireEvent.click(screen.getByRole("tab", { name: "User guide" }));
    fireEvent.click(screen.getByText("How everything connects"));
    expect(screen.getByText(/Converting a qualified lead creates the company/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quotes" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("All topics"));
    expect(screen.getByText("Connecting integrations")).toBeInTheDocument();
    expect(screen.getByText("Using AI")).toBeInTheDocument();
  });

  it("points every welcome step at an element in the layout", async () => {
    const fs = await import("node:fs");
    const { WELCOME } = await import("./content/topics");
    const source = ["src/Layout/Layout.jsx", "src/Menus/SubMenus.jsx", "src/guide/HelpButton.jsx"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const missing = WELCOME.tour.filter((s) => s.target && !source.includes(`data-tour="${s.target}"`)).map((s) => s.target);
    expect(missing).toEqual([]);
  });

  it("links only to routes the app has", async () => {
    const fs = await import("node:fs");
    const { TOPICS } = await import("./content/topics");
    const app = fs.readFileSync("src/App.jsx", "utf8");
    const known = ["/settings", "/crm/dashboard", "/crm/leads", "/crm/pipeline", "/sales/quotes", "/finance/invoices", "/support/tickets", "/projects", "/admin/integrations", "/admin/integrations/marketplace", "/admin/integrations/activity", "/admin/integrations/ai-providers/providers", "/ai/copilot", "/ai/overview", "/admin/users", "/admin/invitations", "/admin/roles", "/finance/setup"];
    for (const t of TOPICS) for (const [, to] of t.links || []) expect(known, `${t.id}: ${to}`).toContain(to.split("?")[0]);
    for (const top of ["/settings", "/crm", "/sales", "/finance", "/support", "/projects", "/admin", "/ai"]) expect(app).toContain(`path="${top}"`);
  });
});
