// SPEC §48 cursor pagination. The cursor is an opaque base64 JSON of the
// last row's id; lists are ordered by id.

import { validationError } from "./response.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(query) {
  let limit = Number.parseInt(query.limit, 10);
  if (!Number.isInteger(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  let cursorId = null;
  if (query.cursor) {
    try {
      const decoded = JSON.parse(
        Buffer.from(String(query.cursor), "base64").toString("utf8")
      );
      if (!Number.isInteger(decoded.id) || decoded.id <= 0) throw new Error();
      cursorId = decoded.id;
    } catch {
      throw validationError("Request validation failed", [
        { field: "cursor", issue: "invalid cursor" },
      ]);
    }
  }
  return { limit, cursorId };
}

/** `rows` must have been fetched with take = limit + 1. */
export function buildPage(rows, limit) {
  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    pagination: {
      limit,
      has_more,
      next_cursor:
        has_more && last
          ? Buffer.from(JSON.stringify({ id: last.id })).toString("base64")
          : null,
    },
  };
}
