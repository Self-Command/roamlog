import { MOCK_AUDIT_STORAGE_KEY, type MockAuditEvent } from "./mock-audit";

export function readMockAuditEvents(): MockAuditEvent[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MOCK_AUDIT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MockAuditEvent[]) : [];
  } catch {
    return [];
  }
}
