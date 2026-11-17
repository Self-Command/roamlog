import { UserSchema, type User } from "@roamlog/contracts";

export interface UserRecordInput {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image: string | null;
  platformRole: string;
  status: string;
  locale: string;
  timezone: string;
  lastActiveAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function presentUser(record: UserRecordInput): User {
  return UserSchema.parse({
    id: record.id,
    email: record.email,
    emailVerified: record.emailVerified,
    name: record.name,
    image: record.image,
    platformRole: record.platformRole,
    status: record.status,
    locale: record.locale,
    timezone: record.timezone,
    lastActiveAt: record.lastActiveAt === null ? null : iso(record.lastActiveAt),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: record.deletedAt === null ? null : iso(record.deletedAt),
  });
}
