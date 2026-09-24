import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = {
  copilotInfo: vi.fn(), listCopilotConversations: vi.fn(), createCopilotConversation: vi.fn(), getCopilotConversation: vi.fn(),
  listCopilotMessages: vi.fn(), sendCopilotMessage: vi.fn(), getCopilotMessage: vi.fn(), cancelCopilotMessage: vi.fn(),
  confirmAction: vi.fn(), cancelAction: vi.fn(), getAction: vi.fn(), updateCopilotMemory: vi.fn(), copilotFeedback: vi.fn(),
};
vi.mock("../../../Helpers/backendAiClient", () => ({
  ...Object.fromEntries(Object.keys(api).map((k) => [k, (...a) => api[k](...a)])),
  copilotEventsUrl: (id) => `/events/${id}`,
  aiErrorMessage: (e) => e?.message || "failed",
}));

const { default: AiCopilotBackend } = await import("./AiCopilotBackend");
const renderPage = () => render(<MemoryRouter><AiCopilotBackend /></MemoryRouter>);

const conversation = { _id: "acc_1", title: "Review my pipeline", mode: "ask", version: 1, createdAt: new Date().toISOString() };
const answer = {
  _id: "m2", role: "assistant", status: "Completed", content: "Found 2 authorized records.", confidence: "High Confidence", limitations: ["Retrieval was limited — more records match than were read."],
  freshness: { retrievedAt: new Date().toISOString() }, simulatorLabel: "AI Provider Simulator", completedAt: new Date().toISOString(),
  parts: [
    { kind: "finding", data: { text: "Acme renewal — stage Proposal", citations: ["E1"] } },
    { kind: "proposal", data: { _id: "aia_1", label: "Add next action", status: "Awaiting Confirmation", reason: "No next action recorded.", proposedValues: { nextAction: "Agree next step" } } },
    { kind: "memory_proposal", data: { memoryId: "mem_1", key: "summary_length", value: "short", reason: "You asked for short summaries." } },
  ],
  citations: [{ _id: "c1", key: "E1", recordType: "Deal", recordId: "d1", label: "Acme renewal", route: "/crm/deals/d1", retrievalMethod: "exact", status: "Valid", recordTimestamp: new Date().toISOString() }],
};

describe("AiCopilotBackend (backend AI mode)", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.copilotInfo.mockResolvedValue({ aiMode: "simulator", simulatorLabel: "AI Provider Simulator — no external AI provider is connected.", disclaimer: "AI Copilot uses authorized CRM data and may make mistakes.", permissions: { workflows: true, memory: true } });
    api.listCopilotConversations.mockResolvedValue({ conversations: [conversation] });
    api.getCopilotConversation.mockResolvedValue({ conversation, context: [], readOnly: false });
    api.listCopilotMessages.mockResolvedValue({ messages: [{ _id: "m1", role: "user", status: "Completed", content: "Review my pipeline", parts: [], citations: [] }, answer] });
    api.getAction.mockResolvedValue({ action: { _id: "aia_1", status: "Awaiting Confirmation" } });
  });

  it("shows the empty state with starters, the simulator label and the disclaimer", async () => {
    renderPage();
    expect(await screen.findByText("How can the Copilot help?")).toBeTruthy();
    expect(screen.getByText("Prepare my day")).toBeTruthy();
    expect(await screen.findByText(/no external AI provider is connected/)).toBeTruthy();
    expect(screen.getByText(/may make mistakes/)).toBeTruthy();
  });

  it("renders a validated answer: findings with sources, confidence, limitations", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Review my pipeline", { selector: "span" }));
    const article = await screen.findByRole("article", { name: "Copilot answer" });
    expect(within(article).getByText(/Acme renewal — stage Proposal/)).toBeTruthy();
    expect(within(article).getByText("High Confidence")).toBeTruthy();
    expect(within(article).getByText(/Retrieval was limited/)).toBeTruthy();
    fireEvent.click(within(article).getByRole("button", { name: /Source E1/ }));
    const drawer = await screen.findByRole("dialog", { name: "Source E1" });
    expect(within(drawer).getByText("Open record").closest("a").getAttribute("href")).toBe("/crm/deals/d1");
  });

  it("a proposal runs only when the person confirms it", async () => {
    api.confirmAction.mockResolvedValue({ action: { _id: "aia_1", status: "Executed", result: { summary: "Next action added." } } });
    renderPage();
    fireEvent.click(await screen.findByText("Review my pipeline", { selector: "span" }));
    await screen.findByRole("article", { name: "Copilot answer" });
    expect(api.confirmAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.confirmAction).toHaveBeenCalledWith("aia_1"));
    expect(await screen.findByText("Next action added.")).toBeTruthy();
  });

  it("a suggested preference is remembered only after acceptance", async () => {
    api.updateCopilotMemory.mockResolvedValue({ memory: { _id: "mem_1", status: "Active" } });
    renderPage();
    fireEvent.click(await screen.findByText("Review my pipeline", { selector: "span" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remember" }));
    await waitFor(() => expect(api.updateCopilotMemory).toHaveBeenCalledWith("mem_1", { status: "Active" }));
  });

  it("sends a message in a new conversation and shows progress with a Stop button", async () => {
    api.listCopilotConversations.mockResolvedValue({ conversations: [] });
    api.createCopilotConversation.mockResolvedValue({ conversation: { ...conversation, _id: "acc_2" } });
    const running = { _id: "m9", role: "assistant", status: "Retrieving", content: "", parts: [], citations: [], limitations: [] };
    api.sendCopilotMessage.mockResolvedValue({ userMessage: { _id: "m8", role: "user", status: "Completed", content: "Which deals need attention?", parts: [], citations: [] }, assistantMessage: running });
    api.getCopilotConversation.mockResolvedValue({ conversation: { ...conversation, _id: "acc_2" }, context: [], readOnly: false });
    api.listCopilotMessages.mockResolvedValue({ messages: [{ _id: "m8", role: "user", status: "Completed", content: "Which deals need attention?", parts: [], citations: [] }, running] });
    api.getCopilotMessage.mockResolvedValue({ message: running });
    api.cancelCopilotMessage.mockResolvedValue({ message: { _id: "m9", status: "Cancelled" } });
    renderPage();
    await screen.findByText("How can the Copilot help?");
    fireEvent.change(screen.getByLabelText("Message the Copilot"), { target: { value: "Which deals need attention?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.sendCopilotMessage).toHaveBeenCalledWith("acc_2", "Which deals need attention?"));
    expect(await screen.findByText(/Reading authorized records/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.cancelCopilotMessage).toHaveBeenCalledWith("m9"));
  });

  it("an audit view is read-only", async () => {
    api.getCopilotConversation.mockResolvedValue({ conversation, context: [], readOnly: true });
    renderPage();
    fireEvent.click(await screen.findByText("Review my pipeline", { selector: "span" }));
    expect(await screen.findByText(/reviewing someone else's conversation/)).toBeTruthy();
    expect(screen.queryByLabelText("Message the Copilot")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });
});
