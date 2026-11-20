/**
 * Minimal `cn` helper for the ported Vercel chat components.
 *
 * The upstream components import shadcn's `cn` (`clsx` + `tailwind-merge`).
 * Roamlog keeps those packages inside `@roamlog/ui` and does not export them,
 * so this dependency-free equivalent concatenates truthy class names. This is
 * an adaptation-layer utility, not part of the upstream component.
 */

type ClassDictionary = Record<string, boolean | null | undefined>;
type ClassValue = string | number | false | null | undefined | ClassValue[] | ClassDictionary;

export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled) classes.push(key);
      }
      return;
    }
    classes.push(String(value));
  };

  inputs.forEach(walk);
  return classes.join(" ");
}
