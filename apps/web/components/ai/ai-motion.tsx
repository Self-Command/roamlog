"use client";

/**
 * Motion primitives for the AI chat surface.
 *
 * Porting source: vercel/chatbot `app/globals.css`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0)
 *   - `@keyframes shimmer` L278–L285
 *   - `@keyframes dot-pulse` L287–L298 (identical to `@keyframes thinking-dot` L311–L322)
 *   - `@utility shimmer` L353–L362
 *   - `@utility dot-pulse` L364–L366
 * and `components/ai-elements/shimmer.tsx` L27–L78 (the `--spread` / 250% background
 * geometry and the `100% center → 0% center` sweep).
 *
 * Adaptation layer (why the upstream file cannot be copied verbatim):
 * 1. The upstream `Shimmer` is a `motion/react` component (`animate={{ backgroundPosition }}`
 *    with `repeat: Infinity`). This repo does not depend on `motion` and the task
 *    forbids new dependencies, so the same keyframes are expressed as plain CSS
 *    keyframes applied to the same element geometry.
 * 2. Upstream puts these `@keyframes`/`@utility` rules in `app/globals.css`. Only
 *    `apps/web/components/ai/**` is writable here, so the rules are emitted once by
 *    `<AiMotionStyles />` (rendered by `thread.tsx`) instead of a global stylesheet.
 *    Class names are prefixed `roamlog-ai-` so they cannot collide with Tailwind.
 * 3. Token adaptation: upstream's shimmer band is `var(--color-background)`, which on
 *    Roamlog's black canvas would be an invisible sweep. The band therefore uses
 *    `var(--ink)` (the high-contrast foreground token) over a `var(--muted)` base.
 * 4. `prefers-reduced-motion: reduce` turns every animation off (hard requirement
 *    §Stage 1.4). Upstream relies on Framer Motion's reduced-motion awareness; CSS
 *    media query is the equivalent here.
 */

export const AI_MOTION_CSS = `
@keyframes roamlog-ai-shimmer {
  from { background-position: 100% center; }
  to { background-position: 0% center; }
}

@keyframes roamlog-ai-dot-pulse {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

@keyframes roamlog-ai-caret {
  0%, 45% { opacity: 1; }
  55%, 100% { opacity: 0; }
}

/* Shimmer text: the base gradient paints the muted colour, the moving band is ink. */
.roamlog-ai-shimmer {
  position: relative;
  display: inline-block;
  width: auto;
  background-image:
    var(--bg),
    linear-gradient(var(--muted), var(--muted));
  background-repeat: no-repeat, padding-box;
  background-size: 250% 100%, auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: roamlog-ai-shimmer 1s linear infinite;
}

.roamlog-ai-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: currentColor;
  animation: roamlog-ai-dot-pulse 1.4s ease-in-out infinite;
}
.roamlog-ai-dot:nth-child(2) { animation-delay: 0.16s; }
.roamlog-ai-dot:nth-child(3) { animation-delay: 0.32s; }

/* Streaming caret sits at the end of the last paragraph of the live answer. */
.roamlog-ai-body[data-streaming="true"] > .roamlog-ai-text:last-of-type > :last-child::after {
  content: "";
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 3px;
  translate: 0 2px;
  background: var(--ink);
  animation: roamlog-ai-caret 1s steps(1, end) infinite;
}

@media (prefers-reduced-motion: reduce) {
  .roamlog-ai-shimmer,
  .roamlog-ai-dot,
  .roamlog-ai-body[data-streaming="true"] > .roamlog-ai-text:last-of-type > :last-child::after {
    animation: none;
  }

  .roamlog-ai-dot {
    opacity: 0.7;
  }

  /* Disabled animation still needs to be readable: no transparent text. */
  .roamlog-ai-shimmer {
    color: var(--muted);
    background-image: none;
  }

  .roamlog-ai-body[data-streaming="true"] > .roamlog-ai-text:last-of-type > :last-child::after {
    opacity: 1;
  }
}
`;

/**
 * Emits the keyframes once per chat surface. Rendered by `thread.tsx`, which is
 * the single mount point of the ported chat page.
 */
export function AiMotionStyles() {
  return <style data-roamlog-ai-motion="">{AI_MOTION_CSS}</style>;
}