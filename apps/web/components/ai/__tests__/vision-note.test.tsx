/**
 * The composer's "this model cannot read images" disclosure.
 *
 * The API's `vision: false` must surface in the UI *before* the user sends a
 * photo: the model would otherwise answer as if it had seen one. These tests
 * cover both halves — the presentational note and the hook that reads the
 * current selection from `GET .../ai/models`.
 */

import type { AiChatModelsResponse } from "@roamlog/contracts";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiChatSelectionStore, resetAiChatSelectionStores } from "../chat-selection";
import {
  useCurrentChatModel,
  VisionNote,
  VISION_UNAVAILABLE_NOTE,
} from "../vision-note";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";

const MODELS: AiChatModelsResponse = {
  models: [
    {
      id: "auto/deepseek-v4.1-flash",
      name: "Deepseek V4.1 Flash",
      provider: "auto",
      reasoning: true,
      vision: false,
    },
    {
      id: "auto/vision-model",
      name: "Vision Model",
      provider: "auto",
      reasoning: true,
      vision: true,
    },
  ],
  defaultModel: "auto/deepseek-v4.1-flash",
  reasoningSupported: true,
};

function stubModels(payload: AiChatModelsResponse = MODELS): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

/** Renders the hook + note exactly the way the composer uses them. */
function Harness() {
  const model = useCurrentChatModel(WORKSPACE_ID);
  return (
    <div>
      <span data-testid="current-model">{model?.id ?? "loading"}</span>
      <VisionNote model={model} />
    </div>
  );
}

beforeEach(() => {
  resetAiChatSelectionStores();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VisionNote", () => {
  it("states that images are not sent when the model has no vision", () => {
    render(<VisionNote model={MODELS.models[0]} />);

    expect(screen.getByTestId("vision-note")).toHaveTextContent(VISION_UNAVAILABLE_NOTE);
    expect(screen.getByTestId("vision-note")).toHaveAttribute("role", "note");
  });

  it("stays silent when the model can read images or the capability is unknown", () => {
    const { rerender } = render(<VisionNote model={MODELS.models[1]} />);
    expect(screen.queryByTestId("vision-note")).not.toBeInTheDocument();

    rerender(<VisionNote model={null} />);
    expect(screen.queryByTestId("vision-note")).not.toBeInTheDocument();
  });
});

describe("useCurrentChatModel", () => {
  it("follows the server default while the user has not picked a model", async () => {
    stubModels();
    render(<Harness />);

    expect(await screen.findByText(MODELS.defaultModel)).toBeInTheDocument();
    expect(
      await screen.findByText(VISION_UNAVAILABLE_NOTE, { exact: false }),
    ).toBeInTheDocument();
  });

  it("re-reads the selection, so switching to a vision model removes the note", async () => {
    stubModels();
    render(<Harness />);
    expect(await screen.findByTestId("vision-note")).toBeInTheDocument();

    act(() => {
      aiChatSelectionStore(WORKSPACE_ID).set({ model: "auto/vision-model" });
    });

    expect(await screen.findByText("auto/vision-model")).toBeInTheDocument();
    expect(screen.queryByTestId("vision-note")).not.toBeInTheDocument();
  });

  it("claims nothing while the model list is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    render(<Harness />);

    expect(await screen.findByText("loading")).toBeInTheDocument();
    expect(screen.queryByTestId("vision-note")).not.toBeInTheDocument();
  });
});