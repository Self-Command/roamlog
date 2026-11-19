/**
 * The bucket an object row owns, or `undefined` when the row predates the
 * bucket column (`Export.bucket` from 0011) or carries an unusable value.
 * Callers pass `undefined` through to `WorkerStorage.deleteObject`, which then
 * falls back to the worker's current bucket and logs a warning.
 */
export function objectBucket(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}