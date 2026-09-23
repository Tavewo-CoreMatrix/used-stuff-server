const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const toInt = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

// Reads ?limit= and ?offset= from a query string with safe bounds.
export const readPagination = (query: Record<string, unknown>) => {
  const limit = Math.min(Math.max(toInt(query.limit) ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(toInt(query.offset) ?? 0, 0);
  return { limit, offset };
};

// Queries fetch `limit + 1` rows; the extra row only signals that another page exists.
export const pageResult = <T>(rows: T[], limit: number) => ({
  data: rows.slice(0, limit),
  meta: { hasMore: rows.length > limit },
});
