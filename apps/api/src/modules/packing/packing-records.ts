import type { PackingCategory } from "@roamlog/contracts";

export interface PackingItemRecord {
  id: string;
  workspaceId: string;
  tripId: string;
  category: PackingCategory;
  name: string;
  quantity: number;
  packed: boolean;
  assigneeId: string | null;
  order: number;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}
