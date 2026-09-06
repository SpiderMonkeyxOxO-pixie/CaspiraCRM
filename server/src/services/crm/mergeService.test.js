import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContactFindFirst = vi.fn();
const mockNoteCount = vi.fn().mockResolvedValue(0);
const mockTagCount = vi.fn().mockResolvedValue(0);
const mockActivityCount = vi.fn().mockResolvedValue(0);
const mockRelCount = vi.fn().mockResolvedValue(0);

vi.mock("../../lib/prisma.js", () => ({
  default: {
    contact: { findFirst: (...a) => mockContactFindFirst(...a) },
    crmNote: { count: (...a) => mockNoteCount(...a) },
    crmRecordTag: { count: (...a) => mockTagCount(...a) },
    activity: { count: (...a) => mockActivityCount(...a) },
    companyContactRelationship: { count: (...a) => mockRelCount(...a) },
  },
}));

const { mergePreview } = await import("./mergeService.js");

describe("mergeService.mergePreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s when either record is missing from this organization", async () => {
    mockContactFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "dest-1" });
    const result = await mergePreview("Contact", "org-1", "missing-1", "dest-1");
    expect(result.error).toEqual(expect.objectContaining({ status: 404, code: "CRM_RECORD_NOT_FOUND" }));
  });

  it("rejects merging a record into itself", async () => {
    mockContactFindFirst.mockResolvedValue({ id: "same-1" });
    const result = await mergePreview("Contact", "org-1", "same-1", "same-1");
    expect(result.error).toEqual(expect.objectContaining({ status: 400, code: "CRM_MERGE_CONFLICT" }));
  });

  it("identifies a field conflict when both records have different non-null values", async () => {
    mockContactFindFirst
      .mockResolvedValueOnce({ id: "src", name: "Alex Smith", phone: "555-1" })
      .mockResolvedValueOnce({ id: "dst", name: "Alexandra Smith", phone: "555-2" });
    const result = await mergePreview("Contact", "org-1", "src", "dst");
    expect(result.fieldConflicts).toEqual(expect.arrayContaining([
      { field: "name", sourceValue: "Alex Smith", destinationValue: "Alexandra Smith", proposedWinner: "Alexandra Smith" },
      { field: "phone", sourceValue: "555-1", destinationValue: "555-2", proposedWinner: "555-2" },
    ]));
  });

  it("proposes filling a destination field only the source has, never overwriting one only the destination has", async () => {
    mockContactFindFirst
      .mockResolvedValueOnce({ id: "src", jobTitle: "CTO" })
      .mockResolvedValueOnce({ id: "dst", jobTitle: null });
    const result = await mergePreview("Contact", "org-1", "src", "dst");
    expect(result.fieldsToFill).toEqual([{ field: "jobTitle", valueFromSource: "CTO" }]);
  });

  it("reports the relationships/notes/tags/activities impact counts", async () => {
    mockContactFindFirst.mockResolvedValueOnce({ id: "src" }).mockResolvedValueOnce({ id: "dst" });
    mockNoteCount.mockResolvedValueOnce(3);
    mockRelCount.mockResolvedValueOnce(2);
    const result = await mergePreview("Contact", "org-1", "src", "dst");
    expect(result.impact).toEqual({ notesToMove: 3, tagsToMove: 0, activitiesToMove: 0, relationshipsToMove: 2 });
  });
});
