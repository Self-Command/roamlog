import type { MediaStatus } from "@roamlog/contracts";

export interface MediaRecord {
  id: string;
  workspaceId: string;
  tripId: string | null;
  uploaderId: string;
  bucket: string;
  key: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  variants: unknown;
  status: MediaStatus;
  error: string | null;
  caption: string | null;
  date: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
