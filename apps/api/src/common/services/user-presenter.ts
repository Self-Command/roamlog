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

/**
 * `User.image` holds two shapes: a plain URL (legacy rows, external avatars) or
 * the media id of an uploaded avatar (see `modules/users/avatar-image.ts`).
 *
 * The contract field is a URL, so an id cannot be echoed back — it is presented
 * as `null` here and re-signed only by the endpoints that own the storage
 * dependency (`UsersService.presentAccount`, used by `GET/PATCH /v1/me`).
 * Echoing the bare id would fail `UserSchema.image = z.url()` and turn every
 * member list or admin read into a 500.
 */
function presentImage(value: string | null): string | null {
  return value !== null && /^https?:\/\//i.test(value) ? value : null;
}

export function presentUser(record: UserRecordInput): User {
  return UserSchema.parse({
    id: record.id,
    email: record.email,
    emailVerified: record.emailVerified,
    name: record.name,
    image: presentImage(record.image),
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
