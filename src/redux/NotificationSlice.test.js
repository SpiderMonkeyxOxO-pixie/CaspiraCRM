import { describe, it, expect } from "vitest";
import notificationReducer, { fetchNotifications, clearNotifications } from "./NotificationSlice";

const initialState = { notifications: [], unreadCount: 0, loading: false, error: null };

describe("notificationSlice", () => {
  it("does not crash when the API returns no notifications array (regression)", () => {
    // Regression test: fetchNotifications.fulfilled used to do
    // `action.payload.filter(...)` directly, which threw
    // "Cannot read properties of undefined (reading 'filter')"
    // whenever the response didn't include a notifications array
    // (e.g. the mock API's generic fallback response).
    const action = { type: fetchNotifications.fulfilled.type, payload: undefined };
    const state = notificationReducer(initialState, action);
    expect(state.notifications).toEqual([]);
    expect(state.unreadCount).toBe(0);
  });

  it("computes unreadCount from a real notifications array", () => {
    const payload = [{ _id: "1", isRead: false }, { _id: "2", isRead: true }, { _id: "3", isRead: false }];
    const action = { type: fetchNotifications.fulfilled.type, payload };
    const state = notificationReducer(initialState, action);
    expect(state.notifications).toHaveLength(3);
    expect(state.unreadCount).toBe(2);
  });

  it("clearNotifications resets to empty", () => {
    const populated = { notifications: [{ _id: "1", isRead: false }], unreadCount: 1, loading: false, error: null };
    const state = notificationReducer(populated, clearNotifications());
    expect(state.notifications).toEqual([]);
    expect(state.unreadCount).toBe(0);
  });
});
