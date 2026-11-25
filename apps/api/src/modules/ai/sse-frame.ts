import {
  AI_STREAM_DELTA_MAX_CHARS,
  type AiStreamEvent,
} from "@roamlog/contracts";

function splitDelta(value: string): string[] {
  if (value.length <= AI_STREAM_DELTA_MAX_CHARS) {
    return [value];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + AI_STREAM_DELTA_MAX_CHARS, value.length);
    if (end < value.length) {
      const last = value.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        end -= 1;
      }
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Splits only the append-only delta events. A provider may coalesce a very
 * large chunk, but no individual frame may exceed the protocol's hard cap.
 * Splitting by UTF-16 boundaries keeps surrogate pairs intact.
 */
export function splitAiStreamEvent(event: AiStreamEvent): AiStreamEvent[] {
  switch (event.type) {
    case "text.delta":
      return splitDelta(event.delta).map((delta) => ({ ...event, delta }));
    case "reasoning.delta":
      return splitDelta(event.delta).map((delta) => ({ ...event, delta }));
    case "tool.args.delta":
      return splitDelta(event.argsTextDelta).map((argsTextDelta) => ({
        ...event,
        argsTextDelta,
      }));
    default:
      return [event];
  }
}

export function serializeSseEvent(
  event: AiStreamEvent,
  firstSeq: number,
): { frame: string; nextSeq: number } {
  const events = splitAiStreamEvent(event);
  const frame = events
    .map(
      (item, index) =>
        `id: ${String(firstSeq + index).padStart(6, "0")}\nevent: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`,
    )
    .join("");
  return { frame, nextSeq: firstSeq + events.length };
}
