/**
 * Decimal byte formatting for every user-visible size in the web app.
 *
 * Decimal (`/1_000`, not `/1_024`) because the upload ceilings users are shown
 * come from decimal settings: `media.maxUploadBytes` is 25,000,000 bytes and
 * `COVER_MAX_BYTES` mirrors it, so the same limit must read `25 MB` here rather
 * than the binary `23.8 MB`. Binary units made the UI contradict the setting it
 * was describing.
 *
 * The rules are byte-for-byte the ones `apps/web/components/media/
 * cover-upload-validation.ts` established: MB keeps one decimal place and drops
 * a trailing `.0`, KB stays integral, bytes stay exact. That module still holds
 * its own copy because it sits outside this task's file boundary; when its owner
 * migrates, it should import this function instead of keeping a second
 * implementation.
 *
 * Display only — every threshold comparison must stay in raw bytes.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    const megabytes = bytes / 1_000_000;
    return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
  }
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}