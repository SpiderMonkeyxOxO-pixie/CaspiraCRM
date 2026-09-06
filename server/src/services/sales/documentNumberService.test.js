import { describe, it, expect, vi } from "vitest";
import { nextDocumentNumber } from "./documentNumberService.js";

function fakeTx() {
  let value = 0;
  return {
    salesDocumentCounter: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockImplementation(async () => {
        value += 1;
        return { value };
      }),
    },
  };
}

describe("nextDocumentNumber", () => {
  it("produces a PREFIX-YEAR-000001 style number", async () => {
    const tx = fakeTx();
    const number = await nextDocumentNumber(tx, "org-1", "Deal");
    expect(number).toMatch(/^DEAL-\d{4}-000001$/);
  });

  it("increments sequentially across calls", async () => {
    const tx = fakeTx();
    const first = await nextDocumentNumber(tx, "org-1", "Quote");
    const second = await nextDocumentNumber(tx, "org-1", "Quote");
    expect(first).toMatch(/000001$/);
    expect(second).toMatch(/000002$/);
  });

  it("uses the correct prefix per document type", async () => {
    const tx = fakeTx();
    expect(await nextDocumentNumber(tx, "org-1", "Order")).toMatch(/^ORDER-/);
  });

  it("rejects an unknown document type", async () => {
    const tx = fakeTx();
    await expect(nextDocumentNumber(tx, "org-1", "Invoice")).rejects.toThrow(/Unknown document type/);
  });
});
