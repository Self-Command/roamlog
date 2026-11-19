"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface LivePhotoProps {
  /** Signed still URL. The component renders nothing without a still. */
  stillUrl: string;
  /** Signed motion URL; `null` means "plain photo" and hides the LIVE badge. */
  motionUrl: string | null;
  alt: string;
  /** `motion.durationMs`, shown as a caption on the badge when known. */
  durationMs?: number | null;
  className?: string;
  /**
   * Accessible copy for embedding surfaces (the public share page). Private
   * callers keep the `alt`-derived defaults, so nothing changes for them.
   */
  labels?: {
    /** Name of the control while the motion asset can still play. */
    live: string;
    /** Name once the motion failed and only the still is left. */
    still: string;
  };
  /**
   * When set, the `<video>` is exposed with this accessible name instead of
   * being hidden from assistive technology. A `<video>` without `controls` is
   * not a widget, so the label documents the layer; the button stays the
   * single keyboard entry point.
   */
  videoLabel?: string;
  /**
   * Called when the still itself fails to load (expired signed URL). Embedders
   * use it to swap in their own placeholder; omitted keeps a plain `<img>`.
   */
  onStillError?: () => void;
  /**
   * Test/embedding seam. When omitted the component reads
   * `prefers-reduced-motion` itself and follows live changes.
   */
  prefersReducedMotion?: boolean;
}

/** Long-press delay before playback starts; matches the iOS feel. */
const LONG_PRESS_MS = 250;

/**
 * Apple-style Live Photo surface: the still is always visible, and the paired
 * movie plays while the user long-presses (touch) or hovers (pointer).
 *
 * Rules that exist for real platform reasons:
 * - `muted` + `playsInline` are required for inline playback on iOS; `play()`
 *   can still reject (low-power mode) and the component falls back to the still.
 * - `preload="none"` keeps a gallery from downloading every movie in the list.
 * - `prefers-reduced-motion: reduce` disables *automatic* playback (hover and
 *   long-press); an explicit click or Enter still plays, because the user asked.
 * - A video that fails to load is dropped and the still is kept; no error UI.
 */
export function LivePhoto({
  stillUrl,
  motionUrl,
  alt,
  durationMs = null,
  className,
  labels,
  videoLabel,
  onStillError,
  prefersReducedMotion,
}: LivePhotoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(Boolean(prefersReducedMotion));

  useEffect(() => {
    setFailed(false);
    setPlaying(false);
  }, [motionUrl]);

  useEffect(() => {
    if (prefersReducedMotion !== undefined) {
      setReduced(prefersReducedMotion);
      return;
    }
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener?.("change", listener);
    return () => query.removeEventListener?.("change", listener);
  }, [prefersReducedMotion]);

  const cancelLongPress = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    cancelLongPress();
    const video = videoRef.current;
    if (!video) return;
    try {
      video.pause();
      video.currentTime = 0;
    } catch {
      // A detached or not-yet-loaded element must not throw through React.
    }
    setPlaying(false);
  }, [cancelLongPress]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video || failed || !motionUrl) return;
    try {
      const result = video.play() as unknown;
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch(() => setPlaying(false));
      }
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [failed, motionUrl]);

  useEffect(() => () => cancelLongPress(), [cancelLongPress]);

  const hasMotion = Boolean(motionUrl) && !failed;

  const startLongPress = () => {
    if (reduced || !hasMotion) return;
    cancelLongPress();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      play();
    }, LONG_PRESS_MS);
  };

  return (
    <button
      type="button"
      data-testid="live-photo"
      data-playing={playing ? "true" : "false"}
      data-live-photo={hasMotion ? "true" : "false"}
      className={`group relative block overflow-hidden ${className ?? ""}`}
      aria-label={
        hasMotion
          ? (labels?.live ?? `${alt}（实况照片：聚焦或长按播放动图，按 Enter 播放）`)
          : (labels?.still ?? `${alt}（照片）`)
      }
      onPointerDown={startLongPress}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onMouseEnter={() => {
        if (!reduced) play();
      }}
      onMouseLeave={stop}
      onClick={play}
      onKeyDown={(event) => {
        // Space is the native activation key of a `<button>`; handling it here
        // keeps Enter and Space on one code path and stops the browser's
        // synthetic click from firing a second play.
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          play();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") stop();
      }}
      onBlur={stop}
    >
      <img
        src={stillUrl}
        alt={alt}
        onError={onStillError}
        className="h-full w-full object-cover"
        draggable={false}
      />
      {hasMotion ? (
        <video
          ref={videoRef}
          data-testid="live-photo-video"
          src={motionUrl ?? undefined}
          poster={stillUrl}
          muted
          playsInline
          preload="none"
          aria-label={videoLabel}
          aria-hidden={videoLabel ? undefined : true}
          onError={() => {
            setFailed(true);
            setPlaying(false);
          }}
          onEnded={stop}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            playing ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
      {hasMotion ? (
        <span
          data-testid="live-photo-badge"
          className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-white"
        >
          LIVE
          {durationMs !== null && durationMs > 0 ? (
            <span className="ml-1 opacity-70">{Math.round(durationMs / 1000)}s</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}