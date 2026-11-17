export type AdminDataMode = "fixture" | "api";

export function resolveAdminDataMode(value: string | undefined): AdminDataMode {
  return value === "api" ? "api" : "fixture";
}

export function getAdminDataMode(): AdminDataMode {
  return resolveAdminDataMode(process.env.NEXT_PUBLIC_ADMIN_DATA_MODE);
}
