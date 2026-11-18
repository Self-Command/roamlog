/**
 * Minimal CSV helpers shared by the Admin export endpoints.
 *
 * Values are always quoted, embedded quotes are doubled, and formula-leading
 * characters are prefixed with an apostrophe so spreadsheet applications do
 * not execute exported user-controlled content.
 */
export function csvValue(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function csvHeader(columns: readonly string[]): string {
  return `${columns.join(",")}\r\n`;
}

export function csvRow(columns: readonly string[], row: Record<string, unknown>): string {
  return `${columns.map((column) => csvValue(row[column])).join(",")}\r\n`;
}

export const CSV_BOM = "\uFEFF";