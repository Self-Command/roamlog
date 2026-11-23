import type { AiArtifact, AiArtifactSuggestion } from "@roamlog/contracts";
import { Button } from "@roamlog/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AiArtifactProvider,
  useAiArtifact,
} from "./artifact-context";

const api = vi.hoisted(() => ({
  getAiArtifact: vi.fn(),
  listAiArtifactSuggestions: vi.fn(),
  listAiArtifactVersions: vi.fn(),
  restoreAiArtifactVersion: vi.fn(),
  setAiArtifactSuggestionResolved: vi.fn(),
  updateAiArtifact: vi.fn(),
}));

vi.mock("../../../lib/api/ai-artifacts", () => api);

const WORKSPACE_ID = "01942f30-1200-7000-8000-0000000000aa";
const ARTIFACT_ID = "01942f30-1200-7000-8000-000000000a01";
const ORIGINAL = "这是一段需要润色的文字。";
const SUGGESTED = "这是一段已经润色的文字。";

function artifact(overrides: Partial<AiArtifact> = {}): AiArtifact {
  return {
    id: ARTIFACT_ID,
    workspaceId: WORKSPACE_ID,
    userId: "01942f30-1200-7000-8000-0000000000bb",
    conversationId: null,
    title: "京都路书",
    kind: "text",
    content: ORIGINAL,
    mediaId: null,
    version: 1,
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
    ...overrides,
  };
}

const suggestion: AiArtifactSuggestion = {
  id: "01942f30-1200-7000-8000-0000000009a1",
  artifactId: ARTIFACT_ID,
  description: "让句子更顺",
  originalText: ORIGINAL,
  suggestedText: SUGGESTED,
  isResolved: false,
  createdAt: "2026-11-23T00:00:00.000Z",
};

function Harness({ target = suggestion }: { target?: AiArtifactSuggestion }) {
  const context = useAiArtifact();
  return (
    <div>
      <output data-testid="content">{context.currentContent}</output>
      <output data-testid="server-content">{context.artifact?.content ?? ""}</output>
      <output data-testid="error">{context.error ?? ""}</output>
      <output data-testid="status">{context.status}</output>
      <Button onClick={() => void context.openArtifact(ARTIFACT_ID)} type="button">
        open
      </Button>
      <Button onClick={() => void context.applySuggestion(target)} type="button">
        apply
      </Button>
    </div>
  );
}

function renderProvider() {
  render(
    <AiArtifactProvider workspaceId={WORKSPACE_ID}>
      <Harness />
    </AiArtifactProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getAiArtifact.mockResolvedValue(artifact());
  api.listAiArtifactVersions.mockResolvedValue([
    {
      id: "01942f30-1200-7000-8000-000000000c01",
      artifactId: ARTIFACT_ID,
      version: 1,
      content: ORIGINAL,
      createdAt: "2026-11-23T00:00:00.000Z",
    },
  ]);
  api.listAiArtifactSuggestions.mockResolvedValue([suggestion]);
});

describe("AiArtifactProvider", () => {
  it("does not resolve a suggestion when the content write fails", async () => {
    const user = userEvent.setup();
    api.updateAiArtifact.mockRejectedValue(
      new Error("The artifact was changed by another request. Reload and retry."),
    );
    renderProvider();

    await user.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByTestId("content")).toHaveTextContent(ORIGINAL));

    await user.click(screen.getByRole("button", { name: "apply" }));

    expect(await screen.findByTestId("error")).toHaveTextContent(
      "The artifact was changed by another request",
    );
    // The failed write keeps the user's draft on screen while the last
    // server-confirmed artifact remains untouched.
    expect(screen.getByTestId("content")).toHaveTextContent(SUGGESTED);
    expect(screen.getByTestId("server-content")).toHaveTextContent(ORIGINAL);
    expect(api.setAiArtifactSuggestionResolved).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("error");
  });

  it("saves the suggestion text before marking the suggestion resolved", async () => {
    const user = userEvent.setup();
    const updated = artifact({ content: SUGGESTED, version: 2 });
    api.updateAiArtifact.mockResolvedValue(updated);
    api.listAiArtifactVersions
      .mockResolvedValueOnce([
        {
          id: "01942f30-1200-7000-8000-000000000c01",
          artifactId: ARTIFACT_ID,
          version: 1,
          content: ORIGINAL,
          createdAt: "2026-11-23T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "01942f30-1200-7000-8000-000000000c01",
          artifactId: ARTIFACT_ID,
          version: 1,
          content: ORIGINAL,
          createdAt: "2026-11-23T00:00:00.000Z",
        },
        {
          id: "01942f30-1200-7000-8000-000000000c02",
          artifactId: ARTIFACT_ID,
          version: 2,
          content: SUGGESTED,
          createdAt: "2026-11-23T00:00:01.000Z",
        },
      ]);
    api.setAiArtifactSuggestionResolved.mockResolvedValue({
      ...suggestion,
      isResolved: true,
    });
    renderProvider();

    await user.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByTestId("content")).toHaveTextContent(ORIGINAL));
    await user.click(screen.getByRole("button", { name: "apply" }));

    await waitFor(() => {
      expect(api.updateAiArtifact).toHaveBeenCalledWith(
        WORKSPACE_ID,
        ARTIFACT_ID,
        expect.objectContaining({ content: SUGGESTED, version: 1 }),
      );
      expect(api.setAiArtifactSuggestionResolved).toHaveBeenCalledWith(
        WORKSPACE_ID,
        ARTIFACT_ID,
        suggestion.id,
        true,
      );
    });
    expect(screen.getByTestId("content")).toHaveTextContent(SUGGESTED);
  });
});
