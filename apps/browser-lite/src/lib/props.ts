/**
 * Reads a property from a server response. Identity responses are PascalCase,
 * API responses are camelCase, and some nested models mix both.
 */
export function prop<T = unknown>(obj: unknown, name: string): T | undefined {
  if (obj == null || typeof obj !== "object") {
    return undefined;
  }
  const record = obj as Record<string, unknown>;
  const camel = name[0].toLowerCase() + name.slice(1);
  const pascal = name[0].toUpperCase() + name.slice(1);
  return (record[name] ?? record[camel] ?? record[pascal]) as T | undefined;
}
