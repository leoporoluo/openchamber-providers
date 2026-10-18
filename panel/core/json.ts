/**
 * JSON values as they appear in opencode.json. Kept free of DOM and host code
 * so the provider logic stays unit-testable.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const isObject = (value: unknown): value is JsonObject => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const objectOf = (value: unknown): JsonObject => (isObject(value) ? value : {});

export const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '');

export const stringList = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
);

/** A positive whole number typed as text, or undefined for anything else. */
export const positiveInt = (text: string): number | undefined => {
  const normalized = text.trim();
  if (!/^[0-9]+$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
};

/**
 * Copies `source` without the keys whose value is undefined, so building a
 * block never writes `"key": null` where a field is simply absent.
 */
export const withoutUndefined = (source: Record<string, Json | undefined>): JsonObject => {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};
