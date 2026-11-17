export interface MockAuditInput {
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface MockAuditEvent extends MockAuditInput {
  id: string;
  actorName: string;
  createdAt: string;
}

export const MOCK_AUDIT_STORAGE_KEY = "roamlog.admin.mockAudit.v1";
export const MOCK_AUDIT_EVENT_NAME = "roamlog:admin-mock-audit";

function readStoredEvents(): MockAuditEvent[] {
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

export function recordMockAuditEvent(input: MockAuditInput): MockAuditEvent {
  const event: MockAuditEvent = {
    ...input,
    id: `mock-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actorName: "当前模拟管理员",
    createdAt: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    const events = [...readStoredEvents(), event].slice(-50);
    window.localStorage.setItem(MOCK_AUDIT_STORAGE_KEY, JSON.stringify(events));
    window.dispatchEvent(new CustomEvent(MOCK_AUDIT_EVENT_NAME, { detail: event }));
  }

  return event;
}
