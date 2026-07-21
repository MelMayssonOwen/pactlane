import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  const json = JSON.stringify(sortValue(value));
  if (json === undefined) throw new TypeError("value is not JSON-serializable");
  return json;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

export function hashArgs(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
