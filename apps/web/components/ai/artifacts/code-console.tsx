"use client";

import { Loader2, Terminal, X } from "lucide-react";

import { Button } from "@roamlog/ui";

import type { ConsoleOutput } from "./code-runner";

const STATUS_LABEL: Record<ConsoleOutput["status"], string> = {
  in_progress: "正在初始化 Python…",
  loading_packages: "正在加载依赖…",
  completed: "",
  failed: "",
};

/** Console ported from vercel/chatbot `components/chat/console.tsx`. */
export function ArtifactCodeConsole({
  outputs,
  onClear,
}: {
  outputs: readonly ConsoleOutput[];
  onClear: () => void;
}) {
  if (outputs.length === 0) return null;

  return (
    <section
      aria-label="代码运行结果"
      className="max-h-72 shrink-0 overflow-y-auto border-t border-hairline bg-surface-1"
      data-testid="artifact-code-console"
    >
      <header className="sticky top-0 z-10 flex h-9 items-center justify-between border-b border-hairline bg-surface-1/95 px-3 backdrop-blur">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
          <Terminal aria-hidden="true" className="size-3.5" />
          Console
        </span>
        <Button
          aria-label="清空运行结果"
          className="size-7 px-0"
          onClick={onClear}
          size="sm"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </header>
      <ol className="divide-y divide-hairline">
        {[...outputs].reverse().map((output, index) => (
          <li
            className="flex gap-3 px-3 py-2.5 font-mono text-[11px] leading-5"
            key={output.id}
          >
            <span
              className={
                output.status === "completed"
                  ? "w-7 shrink-0 text-accent-green"
                  : output.status === "failed"
                    ? "w-7 shrink-0 text-accent-red"
                    : "w-7 shrink-0 text-stone"
              }
            >
              [{outputs.length - index}]
            </span>
            {output.status === "in_progress" || output.status === "loading_packages" ? (
              <span className="flex min-w-0 items-start gap-2 text-muted">
                <Loader2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin" />
                <span className="break-words">
                  {output.contents[0]?.value ?? STATUS_LABEL[output.status]}
                </span>
              </span>
            ) : (
              <div className="min-w-0 flex-1 space-y-2 text-body">
                {output.contents.length === 0 ? (
                  <span className="text-muted">（没有输出）</span>
                ) : (
                  output.contents.map((content, contentIndex) =>
                    content.type === "image" ? (
                      <img
                        alt="Python 运行输出"
                        className="max-w-full rounded-control border border-hairline"
                        key={`${output.id}-image-${String(contentIndex)}`}
                        src={content.value}
                      />
                    ) : (
                      <pre
                        className="whitespace-pre-wrap break-words font-[inherit]"
                        key={`${output.id}-text-${String(contentIndex)}`}
                      >
                        {content.value}
                      </pre>
                    ),
                  )
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
