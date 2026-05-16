export const compactActionValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (depth > 8) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => compactActionValue(entry, depth + 1, seen));
  if (typeof value !== 'object') return String(value);

  const objectValue = value as object;
  if (seen.has(objectValue)) return null;
  seen.add(objectValue);

  const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, compactActionValue(entry, depth + 1, seen)]);
  seen.delete(objectValue);
  return Object.fromEntries(entries);
};
