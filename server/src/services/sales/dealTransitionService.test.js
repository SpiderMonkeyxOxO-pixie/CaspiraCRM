import { describe, it, expect } from "vitest";
import { validateTransition, validateReopen, statusForClassification } from "./dealTransitionService.js";

const openStage = { id: "s-open", name: "Discovery", classification: "Open", requiredFields: [] };
const wonStage = { id: "s-won", name: "Won", classification: "Won", requiredFields: [] };
const lostStage = { id: "s-lost", name: "Lost", classification: "Lost", requiredFields: [] };

describe("validateTransition", () => {
  it("requires an actual close date to mark Won", () => {
    const errors = validateTransition({ deal: {}, fromStage: openStage, toStage: wonStage });
    expect(errors.some((e) => /actual close date/.test(e.message))).toBe(true);
  });

  it("allows marking Won when actualClosingDate is supplied", () => {
    const errors = validateTransition({ deal: {}, fromStage: openStage, toStage: wonStage, actualClosingDate: new Date() });
    expect(errors).toHaveLength(0);
  });

  it("requires a loss reason to mark Lost", () => {
    const errors = validateTransition({ deal: {}, fromStage: openStage, toStage: lostStage });
    expect(errors.some((e) => /loss reason/.test(e.message))).toBe(true);
  });

  it("rejects moving a closed Deal back to an Open stage directly", () => {
    const errors = validateTransition({ deal: { status: "Won" }, fromStage: wonStage, toStage: openStage });
    expect(errors.some((e) => /reopen/.test(e.message))).toBe(true);
  });

  it("enforces a Stage's required fields", () => {
    const stageNeedsContact = { ...openStage, requiredFields: ["primaryContactId"] };
    const errors = validateTransition({ deal: {}, fromStage: openStage, toStage: stageNeedsContact });
    expect(errors.some((e) => /primaryContactId/.test(e.message))).toBe(true);
  });

  it("requires an explicit destination Stage when moving cross-pipeline", () => {
    const deal = { pipelineId: "p-1" };
    const errors = validateTransition({ deal, fromStage: openStage, toStage: null, toPipeline: { id: "p-2" } });
    expect(errors.some((e) => /explicit destination Stage/.test(e.message))).toBe(true);
  });
});

describe("validateReopen", () => {
  it("rejects reopening an already-open Deal", () => {
    const errors = validateReopen({ deal: { status: "Open" }, reason: "test" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("requires a reason", () => {
    const errors = validateReopen({ deal: { status: "Lost" }, reason: "" });
    expect(errors.some((e) => /requires a reason/.test(e.message))).toBe(true);
  });

  it("allows reopening a Lost Deal with a reason", () => {
    const errors = validateReopen({ deal: { status: "Lost" }, reason: "Customer reconsidered" });
    expect(errors).toHaveLength(0);
  });
});

describe("statusForClassification", () => {
  it("maps every classification to the frontend's real status vocabulary", () => {
    expect(statusForClassification("Open")).toBe("Open");
    expect(statusForClassification("Won")).toBe("Won");
    expect(statusForClassification("Lost")).toBe("Lost");
    expect(statusForClassification("Cancelled")).toBe("Cancelled");
    expect(statusForClassification("OnHold")).toBe("On Hold");
  });
});
