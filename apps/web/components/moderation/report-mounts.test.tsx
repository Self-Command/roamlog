import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { JournalEntry } from "@roamlog/contracts";

import { demoComments, demoEntries, demoMembers, demoUser } from "@/test/fixtures";

import { JournalComments } from "@/components/journal/journal-comments";
import { JournalEditorSheet } from "@/components/journal/journal-editor-sheet";
import type { JournalEntryRepository } from "@/components/journal/journal-repository";

const entry = demoEntries[0] as JournalEntry;

function repository(): JournalEntryRepository {
  return {
    getEntry: vi.fn(async () => entry),
    createEntry: vi.fn(async () => entry),
    saveEntry: vi.fn(async () => entry),
    listRevisions: vi.fn(async () => []),
    restoreRevision: vi.fn(async () => entry),
  };
}

/**
 * Mount coverage: every reportable target type needs a real entry point, and a
 * Viewer (canEdit=false) must still see it. These tests render the production
 * surfaces and open their MoreHorizontal menu.
 */
describe("report entry points", () => {
  it("shows 举报 on every comment for a Viewer", async () => {
    const user = userEvent.setup();
    render(
      <JournalComments
        comments={demoComments}
        members={demoMembers}
        currentUserId={demoUser.id}
        disabled
      />,
    );

    const triggers = screen.getAllByRole("button", { name: /更多操作：.*的评论/ });
    expect(triggers.length).toBe(demoComments.length);

    await user.click(triggers[0] as HTMLElement);
    expect(await screen.findByRole("menuitem", { name: "举报" })).toBeInTheDocument();
  });

  it("shows 举报 for an existing journal entry without closing the editor", async () => {
    const user = userEvent.setup();
    render(
      <JournalEditorSheet
        open
        onOpenChange={() => undefined}
        entry={entry}
        repository={repository()}
        canEdit={false}
        canComment={false}
        members={demoMembers}
        currentUserId={demoUser.id}
        comments={demoComments}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: `更多操作：${entry.title}`,
    });
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "举报" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "举报" }));
    // Reporting is a side action: the editor sheet stays mounted.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("举报这条内容")).toBeInTheDocument();
  });
});