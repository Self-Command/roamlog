import { demoEntries, demoMembers, demoUser } from "@roamlog/api-mocks/fixtures";
import type { EntryRevision, JournalEntry } from "@roamlog/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

import { JournalEditorSheet } from "./journal-editor-sheet";
import type { JournalEntryRepository } from "./journal-repository";

const entry = demoEntries[0] as JournalEntry;

function repository(overrides: Partial<JournalEntryRepository> = {}): JournalEntryRepository {
  return {
    mode: "api",
    getEntry: vi.fn(async () => entry),
    createEntry: vi.fn(async (_tripId, payload) => ({
      ...entry,
      id: "019a7e3a-2b40-7c1d-8a5f-000000009999",
      title: payload.title,
      version: 1,
    })),
    saveEntry: vi.fn(async (_entryId, payload, expectedVersion) => ({
      ...entry,
      title: payload.title,
      contentJson: payload.contentJson,
      contentHtml: payload.contentHtml,
      version: expectedVersion + 1,
    })),
    listRevisions: vi.fn(async () => []),
    restoreRevision: vi.fn(async () => entry),
    ...overrides,
  };
}

function renderSheet(options: {
  repo?: JournalEntryRepository;
  entry?: JournalEntry;
  onSubmitComment?: (body: string, mentionIds: string[]) => Promise<void> | void;
}) {
  return render(
    <JournalEditorSheet
      open
      onOpenChange={() => {}}
      entry={options.entry ?? entry}
      repository={options.repo ?? repository()}
      canEdit
      canComment
      members={demoMembers}
      currentUserId={demoUser.id}
      comments={[]}
      onSubmitComment={options.onSubmitComment}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JournalEditorSheet", () => {
  it("autosaves five seconds after the draft becomes dirty", async () => {
    const saveEntry = vi.fn(async (_entryId, payload, expectedVersion) => ({
      ...entry,
      title: payload.title,
      version: expectedVersion + 1,
    }));
    const repo = repository({ saveEntry });
    renderSheet({ repo });
    await screen.findByRole("toolbar", { name: "日志格式工具栏" });

    fireEvent.change(screen.getByRole("textbox", { name: /标题/ }), {
      target: { value: "新的日志标题" },
    });
    expect(screen.getByText("有未保存修改")).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5_200));
    });

    expect(saveEntry).toHaveBeenCalledWith(
      entry.id,
      expect.objectContaining({ title: "新的日志标题" }),
      entry.version,
    );
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeInTheDocument());
  }, 10_000);

  it("opens the version conflict dialog on 409 and overwrites with the latest version", async () => {
    const user = userEvent.setup();
    const latest = { ...entry, version: 7 };
    const saveEntry = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, "This entry was updated by someone else.", "VERSION_CONFLICT"),
      )
      .mockResolvedValueOnce({
        ...entry,
        title: "覆盖后的标题",
        version: 8,
      });
    const repo = repository({
      saveEntry,
      getEntry: vi.fn(async () => latest),
    });
    renderSheet({ repo });
    await screen.findByRole("toolbar", { name: "日志格式工具栏" });

    fireEvent.change(screen.getByRole("textbox", { name: /标题/ }), {
      target: { value: "覆盖后的标题" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));

    const dialog = await screen.findByRole("dialog", { name: "有人先保存了" });
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "覆盖保存" }));

    await waitFor(() => expect(saveEntry).toHaveBeenCalledTimes(2));
    expect(saveEntry).toHaveBeenLastCalledWith(
      entry.id,
      expect.objectContaining({ title: "覆盖后的标题" }),
      7,
    );
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeInTheDocument());
  });

  it("lists revisions and restores a selected snapshot", async () => {
    const user = userEvent.setup();
    const revision: EntryRevision = {
      id: "019a7e3a-2b40-7c1d-8a5f-000000000301",
      workspaceId: entry.workspaceId,
      entryId: entry.id,
      version: 3,
      title: "恢复后的标题",
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "旧版本正文" }] }],
      },
      contentHtml: "<p>旧版本正文</p>",
      editedById: demoUser.id,
      createdAt: "2026-11-16T09:30:00.000Z",
    };
    const restored = {
      ...entry,
      title: "恢复后的标题",
      contentHtml: "<p>旧版本正文</p>",
      version: 4,
    };
    const restoreRevision = vi.fn(async () => restored);
    const repo = repository({
      listRevisions: vi.fn(async () => [revision]),
      restoreRevision,
    });
    renderSheet({ repo });

    expect(await screen.findByText("v3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "恢复版本 3" }));

    await waitFor(() => expect(restoreRevision).toHaveBeenCalledWith(entry.id, revision.id));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /标题/ })).toHaveValue("恢复后的标题"),
    );
  });

  it("mentions a member from the comment composer", async () => {
    const user = userEvent.setup();
    const onSubmitComment = vi.fn(async () => {});
    const member = demoMembers.find((candidate) => candidate.user.name === "林晚");
    expect(member).toBeDefined();
    renderSheet({ onSubmitComment });

    const input = screen.getByPlaceholderText("写下评论，输入 @ 提及成员…");
    await user.type(input, "@");
    await user.click(screen.getByRole("button", { name: new RegExp(member!.user.name) }));
    await user.type(input, "一起去看夜枫");
    await user.click(screen.getByRole("button", { name: "发送评论" }));

    await waitFor(() =>
      expect(onSubmitComment).toHaveBeenCalledWith("@林晚 一起去看夜枫", [member!.userId]),
    );
  });
});
