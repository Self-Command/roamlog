import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactCodeWorkspace } from "./code-workspace";

const runPythonMock = vi.hoisted(() => vi.fn());

vi.mock("./code-runner", () => ({ runPython: runPythonMock }));
vi.mock("./code-editor", () => ({
  ArtifactCodeEditor: ({ content }: { content: string }) => (
    <pre data-testid="code-editor-probe">{content}</pre>
  ),
}));

beforeEach(() => {
  runPythonMock.mockReset();
});

describe("ArtifactCodeWorkspace", () => {
  it("runs the current code and renders the console output", async () => {
    const user = userEvent.setup();
    runPythonMock.mockImplementation(
      async (
        _code: string,
        onUpdate: (output: {
          id: string;
          status: "completed";
          contents: { type: "text"; value: string }[];
        }) => void,
      ) => {
        onUpdate({
          id: "run-1",
          status: "completed",
          contents: [{ type: "text", value: "42" }],
        });
      },
    );

    render(<ArtifactCodeWorkspace content="print(42)" editable onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "运行 Python 代码" }));

    expect(runPythonMock).toHaveBeenCalledWith("print(42)", expect.any(Function));
    expect(await screen.findByTestId("artifact-code-console")).toBeVisible();
    expect(screen.getByText("42")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "清空运行结果" }));
    await waitFor(() =>
      expect(screen.queryByTestId("artifact-code-console")).not.toBeInTheDocument(),
    );
  });

  it("does not run an old, read-only version", async () => {
    render(<ArtifactCodeWorkspace content="print(1)" editable={false} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "运行 Python 代码" })).toBeDisabled();
  });
});
