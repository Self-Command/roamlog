export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0);

  if (!first) {
    return "?";
  }

  if (parts.length === 1) {
    return Array.from(first).slice(0, 2).join("").toUpperCase();
  }

  const last = parts.at(-1) ?? first;
  return `${Array.from(first)[0] ?? ""}${Array.from(last)[0] ?? ""}`.toUpperCase();
}
