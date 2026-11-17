import type {
  ExportFormat,
  ExportScope,
  ExportStatus,
} from "@roamlog/contracts";

export interface ExportRecord {
  id: string;
  workspaceId: string;
  tripId: string | null;
  requestedById: string;
  scope: ExportScope;
  format: ExportFormat;
  includeComments: boolean;
  includeExpenses: boolean;
  includeMedia: boolean;
  status: ExportStatus;
  storageKey: string | null;
  error: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}
