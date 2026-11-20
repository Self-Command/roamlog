/**
 * Storage form of `User.image` for uploaded avatars.
 *
 * The settings profile page uploads the avatar through the media pipeline
 * (`presign → PUT → complete → poll`) and used to persist the *signed display
 * URL* of that upload. A SigV4 URL expires after `EXPORT_SIGNED_URL_TTL`
 * (900 s), so the avatar broke fifteen minutes after it was set and the shell
 * fell back to initials.
 *
 * Uploaded avatars now persist the media **id** instead — a stable identifier
 * that never expires — exactly like `Workspace.logoMediaId`. The id is resolved
 * to a freshly signed URL on every authenticated read
 * (`UsersService.presentAccount`), so `GET /v1/me` keeps returning a working
 * `image` URL forever while the stored value stays stable.
 *
 * Rows written before this change still hold a URL; they are passed through
 * untouched (and will eventually expire — dev data only, no migration).
 */

/** `2026/11/<mediaId>/thumb.webp` is the key shape `buildMediaKey` produces. */
const MEDIA_ID_IN_KEY = /[/\\]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[/\\][a-z0-9-]+\.(?:webp|jpe?g|png|avif|heic|heif)(?:[?#]|$)/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a stored `User.image` is a media id rather than a URL. */
export function isAvatarMediaId(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID.test(value.trim());
}

/**
 * Recovers the media id from a signed media URL.
 *
 * `buildMediaKey` embeds the id (`<workspaceId>/<yyyy>/<mm>/<mediaId>/<variant>.<ext>`),
 * so the client can keep sending the upload result URL to `PATCH /v1/me`
 * without the contract growing a second avatar field. The extracted id is only
 * *trusted* after `UsersService` confirms the media row exists and belongs to
 * the caller; an unrecognised URL is stored verbatim (external/legacy avatar).
 */
export function mediaIdFromAvatarUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return MEDIA_ID_IN_KEY.exec(value)?.[1] ?? null;
}