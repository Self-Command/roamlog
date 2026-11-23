"use client";

/**
 * Message Markdown, ported from vercel/chatbot
 * `components/ai-elements/message.tsx:321-339` @ a8989b522fa3672a2ae52f053105e40993b36ca1
 * (Apache-2.0).
 *
 * The upstream plugins provide CJK-aware wrapping, Shiki code highlighting,
 * KaTeX math, and Mermaid diagrams while streaming. Roamlog only adapts the
 * class names to its theme tokens.
 */

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";

const streamdownPlugins = { cjk, code, math, mermaid };

export function Markdown({ text }: { text: string }) {
  if (!text.trim()) return null;

  return (
    <Streamdown
      className="size-full space-y-3 break-words text-sm leading-6 text-body [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      plugins={streamdownPlugins}
    >
      {text}
    </Streamdown>
  );
}
