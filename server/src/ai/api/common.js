// Backend Phase 9 — shared controller helpers.
import { AiError, CATEGORIES, sendAiError } from "../common/errors.js";

export const guard = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err instanceof AiError) return sendAiError(res, err);
    return next(err);
  }
};
export const notFound = (res, what) => res.status(404).json({ code: "AI_NOT_FOUND", message: `${what} not found.` });
export const versionConflict = (res, what) => res.status(409).json({ code: "AI_VERSION_CONFLICT", message: `The ${what} was changed by someone else. Refresh and try again.` });
export const checkVersion = (body, row) => body.version === undefined || Number(body.version) === (row?.version || 0);
export const invalid = (message) => new AiError(CATEGORIES.INVALID_REQUEST, message);
export const page = (q) => {
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 25));
  const pageNo = Math.max(1, Number(q.page) || 1);
  return { take: pageSize, skip: (pageNo - 1) * pageSize, page: pageNo, pageSize };
};
