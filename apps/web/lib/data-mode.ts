export type DataMode = "mock" | "api";

export function resolveDataMode(
  value: string | undefined = process.env.NEXT_PUBLIC_DATA_MODE,
): DataMode {
  return value?.trim().toLowerCase() === "api" ? "api" : "mock";
}

export const DATA_MODE = resolveDataMode();

export function isApiMode(): boolean {
  return DATA_MODE === "api";
}
