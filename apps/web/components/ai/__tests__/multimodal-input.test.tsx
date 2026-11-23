import type { AttachmentAdapter, ChatModelAdapter, PendingAttachment } from "@assistant-ui/react";
import { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime } from "@assistant-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MultimodalInput, type MultimodalInputProps } from "../multimodal-input";
import { resetAiChatModelStoresForTests } from "../model-selector";
import { resetAiChatSelectionStores } from "../chat-selection";
import { TRAVEL_SUGGESTIONS } from "../suggested-actions";
import { VISION_UNAVAILABLE_NOTE } from "../vision-note";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";

const attachmentAdapter: AttachmentAdapter = {
  accept: "image/*",
  async add({ file }: { file: File }): Promise<PendingAttachment> {
    return {
      contentType: file.type,
      file,
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      status: { progress: 0, reason: "uploading", type: "running" },
      type: "image",
    };
  },
  async remove() {},
  async send(attachment) {
    return {
      ...attachment,
      content: [
        {
          filename: attachment.name,
          image: "blob:test-image",
          type: "image",
        },
      ],
      status: { type: "complete" },
    };
  },
};

function Harness({
  commands,
  onRun,
}: {
  commands?: MultimodalInputProps["commands"];
  onRun?: (prompt: string) => void;
}) {
  const model = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages }) {
        const last = messages.at(-1);
        const prompt =
          last && typeof last.content !== "string"
            ? last.content
                .filter(
                  (
                    part,
                  ): part is {
                    type: "text";
                    text: string;
                  } => part.type === "text",
                )
                .map((part) => part.text)
                .join("")
            : "";
        onRun?.(prompt);
        yield {
          content: [{ text: "好的", type: "text" as const }],
          status: { reason: "stop" as const, type: "complete" as const },
        };
      },
    }),
    [onRun],
  );
  const runtime = useLocalRuntime(model, {
    adapters: { attachments: attachmentAdapter },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <MultimodalInput commands={commands} workspaceId={WORKSPACE_ID} />
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function modelResponse(vision = true): Response {
  return new Response(
    JSON.stringify({
      defaultModel: "openai/gpt-5",
      reasoningSupported: true,
      models: [
        {
          id: "openai/gpt-5",
          name: "GPT-5",
          provider: "openai",
          reasoning: true,
          vision,
        },
      ],
    }),
    {
      headers: { "content-type": "application/json" },
      status: 200,
    },
  );
}

beforeEach(() => {
  resetAiChatModelStoresForTests();
  resetAiChatSelectionStores();
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => modelResponse()),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("MultimodalInput", () => {
  it("sends a suggested action through the assistant-ui runtime", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);

    expect(await screen.findByTestId("suggested-actions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: TRAVEL_SUGGESTIONS[0] }));

    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(onRun).toHaveBeenCalledWith(TRAVEL_SUGGESTIONS[0]);
  });

  it("restores a saved draft and runs a slash command with the keyboard", async () => {
    const user = userEvent.setup();
    const modelCommand = vi.fn();
    window.localStorage.setItem("input", "恢复的草稿");

    render(<Harness commands={{ model: modelCommand }} />);

    const input = screen.getByTestId("multimodal-input");
    await waitFor(() => expect(input).toHaveValue("恢复的草稿"));

    await user.clear(input);
    await user.type(input, "/mod");

    expect(await screen.findByTestId("slash-command-menu")).toBeInTheDocument();
    expect(screen.getByTestId("slash-command-model")).toBeInTheDocument();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(modelCommand).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("");
    expect(window.localStorage.getItem("input")).toBeNull();
  });

  it("writes the draft on the input event so an immediate refresh cannot lose it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByTestId("multimodal-input"), "刚刚输入的草稿");

    expect(window.localStorage.getItem("input")).toBe("刚刚输入的草稿");
  });

  it("moves through slash commands with arrow keys", async () => {
    const user = userEvent.setup();
    const newCommand = vi.fn();
    const clearCommand = vi.fn();
    render(<Harness commands={{ clear: clearCommand, new: newCommand }} />);

    await user.type(screen.getByTestId("multimodal-input"), "/");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(clearCommand).toHaveBeenCalledTimes(1));
    expect(newCommand).not.toHaveBeenCalled();
  });

  it("accepts a pasted image without duplicating it", async () => {
    render(<Harness />);
    const file = new File(["image"], "pasted.png", { type: "image/png" });

    fireEvent.paste(screen.getByTestId("multimodal-input"), {
      clipboardData: {
        items: [
          {
            getAsFile: () => file,
            type: "image/png",
          },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("input-attachment-preview")).toHaveLength(1);
    });
  });

  it("accepts a dropped image through the composer dropzone", async () => {
    render(<Harness />);
    const file = new File(["image"], "dropped.png", { type: "image/png" });

    fireEvent.drop(screen.getByTestId("composer-dropzone"), {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("input-attachment-preview")).toHaveLength(1);
    });
  });

  it("keeps the attachment button usable but warns when the model cannot read images", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => modelResponse(false)),
    );
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("attachments-button")).toBeEnabled();
    });
    expect(screen.getByTestId("attachments-button")).toHaveAttribute(
      "title",
      VISION_UNAVAILABLE_NOTE,
    );
    expect(screen.getByTestId("vision-note")).toHaveTextContent(VISION_UNAVAILABLE_NOTE);
  });

  it("caps attachments and keeps the overflow error visible", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("attachments-button")).toBeEnabled();
    });

    const files = Array.from(
      { length: 6 },
      (_, index) =>
        new File([`image-${String(index)}`], `photo-${String(index)}.png`, {
          type: "image/png",
        }),
    );
    await user.upload(screen.getByTestId("attachments-input"), files);

    expect(await screen.findByTestId("composer-error")).toHaveTextContent("一次最多 5 个附件");
    await waitFor(() => {
      expect(screen.getAllByTestId("input-attachment-preview")).toHaveLength(5);
    });
  });
});
