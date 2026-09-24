import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const previewAction = vi.fn();
const confirmAction = vi.fn();
vi.mock("../../../Helpers/backendAiClient", () => ({
  previewAction: (...a) => previewAction(...a),
  confirmAction: (...a) => confirmAction(...a),
  cancelAction: vi.fn(),
  undoAction: vi.fn(),
  aiErrorMessage: (e) => e?.message || "failed",
}));

const { default: GovernedActionDialog } = await import("./GovernedActionDialog");
const renderDialog = (action, extra = {}) => render(<MemoryRouter><GovernedActionDialog insight={{ id: "i1", title: "Stalled deal" }} action={action} canExecute onClose={() => {}} onApplied={() => {}} {...extra} /></MemoryRouter>);

describe("GovernedActionDialog (backend AI mode)", () => {
  beforeEach(() => { previewAction.mockReset(); confirmAction.mockReset(); });

  it("never merges through AI", () => {
    renderDialog({ type: "review_duplicate", label: "Review duplicate", affectedRecordType: "Contact", affectedRecordId: "c1" });
    expect(screen.getByText(/never done through AI/i)).toBeTruthy();
  });

  it("explains targets that aren't supported yet", () => {
    renderDialog({ type: "add_next_action", label: "Add next action", affectedRecordType: "Contract", affectedRecordId: "k1" });
    expect(screen.getByText(/aren't available yet/i)).toBeTruthy();
  });

  it("prepares a proposal, then confirms it — nothing runs before the confirmation", async () => {
    previewAction.mockResolvedValue({ action: { _id: "aia_1", status: "Awaiting Confirmation", impact: "Add next action on Deal.", currentValues: { nextAction: null }, proposedValues: { nextAction: "Call" }, requiredPermission: "deals:edit", expiresAt: new Date().toISOString() } });
    confirmAction.mockResolvedValue({ action: { _id: "aia_1", status: "Executed", label: "Add next action", currentValues: {}, proposedValues: {}, requiredPermission: "deals:edit", expiresAt: new Date().toISOString(), undoAvailable: true } });
    renderDialog({ type: "add_next_action", label: "Add next action", reason: "No next step", affectedRecordType: "Deal", affectedRecordId: "d1" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Call" } });
    fireEvent.click(screen.getByText("Prepare action"));
    await waitFor(() => expect(previewAction).toHaveBeenCalledWith(expect.objectContaining({ actionType: "add_next_action", targetType: "Deal", targetId: "d1", proposedValues: { nextAction: "Call" }, source: "Model" })));
    expect(confirmAction).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText("Confirm"));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledWith("aia_1"));
    expect(await screen.findByText("Executed")).toBeTruthy();
    expect(screen.getByText("Undo")).toBeTruthy();
  });

  it("a role that can't confirm can't prepare either", () => {
    renderDialog({ type: "create_follow_up", label: "Follow up", affectedRecordType: "Deal", affectedRecordId: "d1" }, { canExecute: false });
    expect(screen.getByText("Prepare action").disabled).toBe(true);
  });
});
