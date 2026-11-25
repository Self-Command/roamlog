import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createMemoryStorage,
  renderWithDraftRuntime,
} from "./__tests__/draft-test-runtime";
import { AskUserToolUI } from "./ask-user-tool";
import { ConfirmBriefToolUI } from "./confirm-brief-tool";
import {
  createDraftPersistence,
  draftStorageKey,
} from "./draft-persistence";
import type { AskUserArgs, AskUserResult, ConfirmBriefArgs, ConfirmBriefResult } from "./types";

const askArgs: AskUserArgs = {
  title: "补充出行需求",
  questions: [
    {
      id: "destination",
      prompt: "目的地",
      kind: "text",
    },
  ],
};

const briefArgs: ConfirmBriefArgs = {
  title: "确认需求摘要",
  summary: "京都 5 天，预算 8000 元。",
};

function askProps(
  addResult: (result: AskUserResult) => void = vi.fn(),
  toolCallId = "ask-tool-1",
): ComponentProps<typeof AskUserToolUI> {
  return {
    args: askArgs,
    toolCallId,
    status: { type: "requires-action", reason: "tool-calls" },
    addResult,
  } as unknown as ComponentProps<typeof AskUserToolUI>;
}

function briefProps(
  addResult: (result: ConfirmBriefResult) => void = vi.fn(),
  toolCallId = "brief-tool-1",
): ComponentProps<typeof ConfirmBriefToolUI> {
  return {
    args: briefArgs,
    toolCallId,
    status: { type: "requires-action", reason: "tool-calls" },
    addResult,
  } as unknown as ComponentProps<typeof ConfirmBriefToolUI>;
}

describe("human-tool draft persistence", () => {
  it("restores ask_user values after a provider remount", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const workspaceId = "workspace-ask";
    const conversationId = "conversation-a";
    const first = renderWithDraftRuntime(
      <AskUserToolUI {...askProps()} />,
      {
        conversationId,
        persistence: createDraftPersistence(workspaceId, "user-a", storage),
      },
    );

    await user.type(await screen.findByLabelText("目的地"), "京都");
    await waitFor(() => {
      expect(storage.getItem(draftStorageKey(workspaceId, "user-a"))).toContain("京都");
    });
    first.unmount();

    renderWithDraftRuntime(<AskUserToolUI {...askProps()} />, {
      conversationId,
      persistence: createDraftPersistence(workspaceId, "user-a", storage),
    });

    await waitFor(() => {
      expect(screen.getByLabelText("目的地")).toHaveValue("京都");
    });
  });

  it("restores a confirm_brief revision draft after a provider remount", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const workspaceId = "workspace-brief";
    const conversationId = "conversation-b";
    const first = renderWithDraftRuntime(
      <ConfirmBriefToolUI {...briefProps()} />,
      {
        conversationId,
        persistence: createDraftPersistence(workspaceId, "user-a", storage),
      },
    );

    await user.click(await screen.findByRole("button", { name: "继续修改" }));
    await user.type(
      screen.getByLabelText("怎么修改这份摘要？"),
      "预算改成 5000 元",
    );
    await waitFor(() => {
      expect(storage.getItem(draftStorageKey(workspaceId, "user-a"))).toContain("5000");
    });
    first.unmount();

    renderWithDraftRuntime(<ConfirmBriefToolUI {...briefProps()} />, {
      conversationId,
      persistence: createDraftPersistence(workspaceId, "user-a", storage),
    });

    await waitFor(() => {
      expect(screen.getByLabelText("怎么修改这份摘要？")).toHaveValue(
        "预算改成 5000 元",
      );
    });
  });

  it("isolates drafts by conversation even when the tool call id repeats", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const workspaceId = "workspace-isolation";
    const first = renderWithDraftRuntime(<AskUserToolUI {...askProps()} />, {
      conversationId: "conversation-a",
      persistence: createDraftPersistence(workspaceId, "user-a", storage),
    });

    await user.type(await screen.findByLabelText("目的地"), "大阪");
    await waitFor(() => {
      expect(storage.getItem(draftStorageKey(workspaceId, "user-a"))).toContain("大阪");
    });
    first.unmount();

    renderWithDraftRuntime(<AskUserToolUI {...askProps()} />, {
      conversationId: "conversation-b",
      persistence: createDraftPersistence(workspaceId, "user-a", storage),
    });

    await waitFor(() => {
      expect(screen.getByLabelText("目的地")).toHaveValue("");
    });
  });

  it("drops the draft after a successful submit", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const workspaceId = "workspace-submit";
    const addResult = vi.fn();
    renderWithDraftRuntime(
      <AskUserToolUI {...askProps(addResult)} />,
      {
        conversationId: "conversation-a",
        persistence: createDraftPersistence(workspaceId, "user-a", storage),
      },
    );

    await user.type(await screen.findByLabelText("目的地"), "京都");
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    expect(addResult).toHaveBeenCalledWith({
      answers: {
        destination: { values: [], text: "京都" },
      },
    });
    await waitFor(() => {
      expect(storage.getItem(draftStorageKey(workspaceId, "user-a"))).not.toContain("京都");
    });
  });

  it("isolates drafts by user on a shared device", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const workspaceId = "workspace-user-isolation";
    const conversationId = "conversation-shared";
    const first = renderWithDraftRuntime(<AskUserToolUI {...askProps()} />, {
      conversationId,
      persistence: createDraftPersistence(workspaceId, "user-a", storage),
    });

    await user.type(await screen.findByLabelText("目的地"), "京都");
    await waitFor(() => {
      expect(storage.getItem(draftStorageKey(workspaceId, "user-a"))).toContain("京都");
    });
    first.unmount();

    renderWithDraftRuntime(<AskUserToolUI {...askProps()} />, {
      conversationId,
      persistence: createDraftPersistence(workspaceId, "user-b", storage),
    });

    await waitFor(() => {
      expect(screen.getByLabelText("目的地")).toHaveValue("");
    });
  });
});
