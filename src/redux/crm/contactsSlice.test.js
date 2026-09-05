import { describe, it, expect } from "vitest";
import contactsReducer, {
  fetchContacts,
  fetchContact,
  createContact,
  clearContactDuplicates,
} from "./contactsSlice";

const initialState = contactsReducer(undefined, { type: "@@INIT" });

describe("contactsSlice", () => {
  it("fetchContacts.fulfilled stores exactly one page, not the full dataset", () => {
    const payload = {
      contacts: [{ _id: "1" }, { _id: "2" }],
      total: 41,
      page: 2,
      pageSize: 2,
      summary: { total: 41, prospects: 10, activeCustomers: 5, followUpsDue: 2, overdueFollowUps: 1, doNotContact: 3 },
    };
    const state = contactsReducer(initialState, { type: fetchContacts.fulfilled.type, payload });
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(41);
    expect(state.page).toBe(2);
    expect(state.summary.doNotContact).toBe(3);
  });

  it("fetchContact.rejected sets a not-found flag instead of an infinite loading state (regression)", () => {
    // Mirrors the same fix made for Leads: mock data is in-memory only and
    // is reseeded on every full page load, so a bookmarked/shared contact
    // URL frequently 404s — the UI must show an honest not-found state.
    const withCurrent = { ...initialState, current: { _id: "1", name: "Stale" } };
    const state = contactsReducer(withCurrent, { type: fetchContact.rejected.type, payload: "Contact not found" });
    expect(state.current).toBeNull();
    expect(state.currentNotFound).toBe(true);
  });

  it("fetchContact.fulfilled populates current and clears the not-found flag", () => {
    const withNotFound = { ...initialState, currentNotFound: true };
    const contact = { _id: "1", name: "Taylor Brooks" };
    const state = contactsReducer(withNotFound, { type: fetchContact.fulfilled.type, payload: contact });
    expect(state.current).toEqual(contact);
    expect(state.currentNotFound).toBe(false);
  });

  it("createContact.rejected with a validation-error payload does not populate duplicates", () => {
    const action = {
      type: createContact.rejected.type,
      payload: { message: "Validation failed", errors: { name: "Provide a first or last name" } },
    };
    const state = contactsReducer(initialState, action);
    expect(state.duplicates).toEqual([]);
  });

  it("createContact.rejected with a 409 duplicate payload populates duplicates", () => {
    const dup = { contact: { _id: "1", name: "Existing Contact" }, reasons: ["Same email address"] };
    const action = {
      type: createContact.rejected.type,
      payload: { message: "A possible duplicate contact already exists", duplicates: [dup] },
    };
    const state = contactsReducer(initialState, action);
    expect(state.duplicates).toEqual([dup]);
  });

  it("createContact.fulfilled unshifts the new contact, increments total, and clears duplicates", () => {
    const withDupes = { ...initialState, items: [{ _id: "old" }], total: 1, duplicates: [{ contact: {}, reasons: [] }] };
    const newContact = { _id: "new" };
    const state = contactsReducer(withDupes, { type: createContact.fulfilled.type, payload: newContact });
    expect(state.items[0]._id).toBe("new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
    expect(state.duplicates).toEqual([]);
  });

  it("clearContactDuplicates resets duplicates to empty", () => {
    const withDupes = { ...initialState, duplicates: [{ contact: {}, reasons: ["x"] }] };
    const state = contactsReducer(withDupes, clearContactDuplicates());
    expect(state.duplicates).toEqual([]);
  });
});
