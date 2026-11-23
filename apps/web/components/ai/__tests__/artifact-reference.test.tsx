import type { AiToolCall, AiToolResult } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import { artifactReferenceForResult } from "../plan-card";

const ARTIFACT_ID = "01942f30-1200-7000-8000-000000000a01";

function call(tool: AiToolCall["tool"]): AiToolCall {
  return { tool, args: {} };
}

describe("artifactReferenceForResult", () => {
  it("opens a successful artifact tool from entityId when the legacy result omitted artifact", () => {
    const result: AiToolResult = {
      tool: "artifacts.create",
      ok: true,
      entityId: ARTIFACT_ID,
    };

    expect(artifactReferenceForResult(result, call("artifacts.create"))).toEqual({
      id: ARTIFACT_ID,
    });
  });

  it("preserves the reference title and kind when the API returned them", () => {
    const result: AiToolResult = {
      tool: "artifacts.update",
      ok: true,
      entityId: ARTIFACT_ID,
      artifact: { id: ARTIFACT_ID, title: "京都路书", kind: "text" },
    };

    expect(artifactReferenceForResult(result, call("artifacts.update"))).toEqual({
      id: ARTIFACT_ID,
      title: "京都路书",
      kind: "text",
    });
  });

  it("never opens a result from another tool or a failed artifact write", () => {
    expect(
      artifactReferenceForResult(
        { tool: "trips.create", ok: true, entityId: ARTIFACT_ID },
        call("trips.create"),
      ),
    ).toBeUndefined();
    expect(
      artifactReferenceForResult(
        {
          tool: "artifacts.create",
          ok: false,
          entityId: ARTIFACT_ID,
          error: { code: "AI_TOOL_FAILED", message: "failed" },
        },
        call("artifacts.create"),
      ),
    ).toBeUndefined();
  });
});
