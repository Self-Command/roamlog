"use client";

import { Loader2, Play } from "lucide-react";
import { useState } from "react";

import { Button } from "@roamlog/ui";

import { ArtifactCodeConsole } from "./code-console";
import { ArtifactCodeEditor } from "./code-editor";
import { runPython, type ConsoleOutput } from "./code-runner";

export function ArtifactCodeWorkspace({
  content,
  editable,
  onSave,
}: {
  content: string;
  editable: boolean;
  onSave: (content: string, debounce?: boolean) => void;
}) {
  const [outputs, setOutputs] = useState<ConsoleOutput[]>([]);
  const [running, setRunning] = useState(false);

  async function run(): Promise<void> {
    if (running || !editable) return;
    setRunning(true);
    await runPython(content, (output) => {
      setOutputs((current) => {
        const index = current.findIndex((row) => row.id === output.id);
        if (index === -1) return [...current, output];
        return current.map((row) => (row.id === output.id ? output : row));
      });
    });
    setRunning(false);
  }

  return (
    <div className="flex min-h-full flex-col" data-testid="artifact-code-workspace">
      <div className="flex items-center justify-end border-b border-hairline px-2 py-1.5">
        <Button
          aria-label="运行 Python 代码"
          disabled={running || !editable}
          onClick={() => void run()}
          size="sm"
          type="button"
          variant="outline"
        >
          {running ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Play aria-hidden="true" className="size-3.5" />
          )}
          {running ? "运行中…" : "运行"}
        </Button>
      </div>
      <ArtifactCodeEditor content={content} editable={editable} onSave={onSave} />
      <ArtifactCodeConsole
        onClear={() => setOutputs([])}
        outputs={outputs}
      />
    </div>
  );
}
