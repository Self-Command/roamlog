"use client";

import Lightbox from "yet-another-react-lightbox";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";

import { useEffect, useMemo, useRef } from "react";

import "./photo-lightbox.css";

/**
 * Photo viewer, ported wholesale from `yet-another-react-lightbox@3.33.1` (MIT,
 * igordanchenko/yet-another-react-lightbox @ 6ef6a6e9807ff65023a8acf01a167ea8a8cabcc0).
 *
 * Why that package and not PhotoSwipe/react-photo-view: it is a React 19
 * component with zero runtime dependencies, real focus management
 * (`Portal.tsx:94-145`), `role="dialog"` + `aria-modal` (`Portal.tsx:130-132`),
 * a Zoom plugin and a Thumbnails strip — and its keyboard handler already
 * calls `stopPropagation()` on Escape (`useKeyboardNavigation.ts:29-45`) so a
 * lightbox opened over a Radix Dialog does not also close that Dialog.
 *
 * The only adaptation is the Esc contract this repo depends on: YARL's handler
 * is the stopPropagation, and this component never installs a second Escape
 * listener that could reintroduce the bug.
 *
 * Signed URLs expire after 900 s (`MEDIA_SIGNED_URL_TTL_SECONDS`). YARL exposes
 * no image `onError`, so a capture-phase error listener on the document detects
 * a failed load inside `.yarl__root` and asks the parent to re-sign; the parent
 * hands back a new `items` array, and YARL's `LightboxState.tsx:79` dispatches
 * `update` when the `slides` reference changes, replacing the broken URL in
 * place.
 */

export interface PhotoLightboxItem {
  id: string;
  src: string;
  alt: string;
  width?: number | null;
  height?: number | null;
}

const LABELS = {
  Lightbox: "照片查看",
  Close: "关闭照片查看",
  Next: "下一张",
  Previous: "上一张",
  Slide: "照片",
  Carousel: "照片轮播",
  "Photo gallery": "照片集",
} as const;

/** Re-sign at most once per 2 s so one batch of broken images is one request. */
const RE_SIGN_THROTTLE_MS = 2_000;

export function PhotoLightbox({
  open,
  index,
  items,
  onClose,
  onImageError,
}: {
  open: boolean;
  index: number;
  /** Items whose `src` is already a signed URL, in display order. */
  items: readonly PhotoLightboxItem[];
  onClose: () => void;
  /** Ask the owner to re-sign URLs (expired 900 s after presign). */
  onImageError?: () => void;
}) {
  const slides = useMemo(
    () =>
      items.map((item) => ({
        src: item.src,
        alt: item.alt,
        ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
      })),
    [items],
  );

  const lastReSignRef = useRef(0);

  useEffect(() => {
    if (!open || !onImageError) return;
    const handleError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.closest(".yarl__root")) return;
      const now = Date.now();
      if (now - lastReSignRef.current < RE_SIGN_THROTTLE_MS) return;
      lastReSignRef.current = now;
      onImageError();
    };
    document.addEventListener("error", handleError, true);
    return () => document.removeEventListener("error", handleError, true);
  }, [open, onImageError]);

  const safeIndex = slides.length === 0 ? 0 : Math.min(Math.max(index, 0), slides.length - 1);

  return (
    <Lightbox
      open={open && slides.length > 0}
      index={safeIndex}
      slides={slides}
      close={onClose}
      plugins={[Zoom, Thumbnails]}
      labels={LABELS}
      className="roamlog-photo-lightbox"
      controller={{ closeOnEscape: true }}
      carousel={{ finite: true }}
      animation={{ swipe: 240 }}
      thumbnails={{ position: "bottom", width: 96, height: 64, gap: 8, vignette: true }}
      zoom={{ maxZoom: 4, scrollToZoom: true }}
    />
  );
}