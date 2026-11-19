/**
 * Live Photo pairing.
 *
 * iOS stores a Live Photo as two files that must travel together: the still
 * (`.HEIC`/`.JPG`) and the motion clip (`.MOV`). The web has no Live Photo API,
 * so a desktop export or the Files app hands us a flat list and we rebuild the
 * pairs here. This module is deliberately pure and synchronous — it never reads
 * bytes, never decodes an image and never touches the network — so the rules can
 * be unit-tested with plain `File` stubs and reused by any uploader.
 *
 * Pairing is *additive*: files that do not pair are returned in `unpaired` and
 * must still be uploaded/handled by the caller. Silently dropping a user's file
 * is never acceptable.
 *
 * Rules, in priority order:
 *  1. same basename (case-insensitive) still + `.MOV` → pair;
 *  2. otherwise, if the still's name contains `live`/`livephoto` and there is
 *     exactly one leftover `.MOV`, pair them (lenient fallback for exports that
 *     rename the movie);
 *  3. one still pairs with at most one movie; every extra movie is `unpaired`;
 *  4. anything left over (a still without a movie, a movie without a still, or a
 *     file that is neither) stays in `unpaired`.
 */

export interface LivePhotoPair {
  still: File;
  motion: File;
}

export interface LivePhotoPairing {
  pairs: LivePhotoPair[];
  unpaired: File[];
}

const STILL_EXTENSIONS = /\.(?:heic|heif|jpe?g|png|webp|avif)$/i;
const MOTION_EXTENSIONS = /\.mov$/i;
/** "live" is checked without word boundaries so `IMG_0001_Live.JPG` matches. */
const LIVE_NAME_HINT = /live/i;

export function isStillFile(file: Pick<File, "name" | "type">): boolean {
  const type = file.type.trim().toLowerCase();
  return type.startsWith("image/") || STILL_EXTENSIONS.test(file.name);
}

export function isMotionFile(file: Pick<File, "name" | "type">): boolean {
  const type = file.type.trim().toLowerCase();
  // HEIC stills also report `image/heic`; only a MOV/QuickTime file is motion.
  return type === "video/quicktime" || MOTION_EXTENSIONS.test(file.name);
}

/** Basename without extension, lower-cased for case-insensitive comparison. */
export function fileBasename(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  return base.replace(/\.[^.]+$/, "").trim().toLowerCase();
}

/** Basename including the extension, lower-cased (`img_0001.heic`). */
function lowerName(fileName: string): string {
  return (fileName.split(/[/\\]/).pop() ?? fileName).trim().toLowerCase();
}

export function pairLivePhotos(files: readonly File[]): LivePhotoPairing {
  const stills: File[] = [];
  const motions: File[] = [];
  const others: File[] = [];

  for (const file of files) {
    if (isMotionFile(file)) {
      motions.push(file);
    } else if (isStillFile(file)) {
      stills.push(file);
    } else {
      others.push(file);
    }
  }

  const pairs: LivePhotoPair[] = [];
  const unpaired: File[] = [];
  const motionsByBase = new Map<string, File[]>();
  for (const motion of motions) {
    const base = fileBasename(motion.name);
    const bucket = motionsByBase.get(base) ?? [];
    bucket.push(motion);
    motionsByBase.set(base, bucket);
  }

  // Rule 1 + 3: basename matching, first movie wins, the rest stay unpaired.
  const leftoverStills: File[] = [];
  const claimed = new Set<File>();
  for (const still of stills) {
    const candidates = motionsByBase.get(fileBasename(still.name));
    const motion = candidates?.find((candidate) => !claimed.has(candidate));
    if (motion) {
      claimed.add(motion);
      pairs.push({ still, motion });
    } else {
      leftoverStills.push(still);
    }
  }

  // Rule 2: a single leftover movie plus a still whose name says "live".
  const leftoverMotions = motions.filter((motion) => !claimed.has(motion));
  let lenientStill: File | null = null;
  if (leftoverStills.length > 0 && leftoverMotions.length === 1) {
    lenientStill =
      leftoverStills.find((still) => LIVE_NAME_HINT.test(lowerName(still.name))) ?? null;
    if (lenientStill) {
      const motion = leftoverMotions[0] as File;
      claimed.add(motion);
      pairs.push({ still: lenientStill, motion });
    }
  }

  for (const still of leftoverStills) {
    if (still !== lenientStill) {
      unpaired.push(still);
    }
  }
  for (const motion of motions) {
    if (!claimed.has(motion)) {
      unpaired.push(motion);
    }
  }
  unpaired.push(...others);

  return { pairs, unpaired };
}