"use client";

import type {
  AiChatResponse,
  AiRunExecuteResponse,
  AiToolCall,
  WorkspaceRole,
} from "@roamlog/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@roamlog/ui";
import {
  ArrowUpRight,
  ChevronRight,
  LoaderCircle,
  Send,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  createAiIdempotencyKey,
  createAiPlan,
  executeAiRun,
  toAiRequestError,
  type AiRequestError,
} from "@/lib/api/ai";

import {
  adminSettingsUrl,
  describePlannedCall,
  executionFailureCopy,
  planFailureCopy,
  summarizeReadOnlyTrace,
  toolLabel,
} from "./copy";
import { ConfirmationList, PlanPanel } from "./plan-panel";

const MAX_MESSAGE_LENGTH = 2000;

const PROMPT_SUGGESTIONS = [
  "想去京都一周，预算 8000，喜欢古寺和咖啡馆",
  "带爸妈去成都四天，节奏慢一点，少走路",
  "周末去杭州，预算 2000，想住湖边",
] as const;

interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Read-only calls the server executed while producing this answer. */
  trace?: AiToolCall[];
}

function renderInline(line: string) {
  return line.split(/(\*\*[^*]+\*\*)/u).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-medium text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

/**
 * Renders the assistant's short markdown without an HTML pipeline.
 *
 * The model answers in markdown: headings, bullets, numbered points and small
 * tables. Showing the raw `|` and `##` characters looks like leaked markup, so
 * this keeps the rendered text readable while still treating the message as
 * plain text (no `dangerouslySetInnerHTML`, no link injection).
 */
function FormattedMessage({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {text.split("\n").map((rawLine, lineIndex) => {
        const line = rawLine.trim();
        if (!line) return null;

        // Markdown table separator row (`|---|:--:|`).
        if (/^\|?[\s:|-]+\|?$/u.test(line) && line.includes("-")) return null;

        if (line.startsWith("|")) {
          const cells = line
            .split("|")
            .map((cell) => cell.trim())
            .filter((cell) => cell.length > 0);
          if (cells.length >= 2) {
            return (
              <p key={lineIndex} className="flex items-baseline gap-3">
                <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  {cells[0]}
                </span>
                <span className="min-w-0 text-sm leading-6 text-body">
                  {renderInline(cells.slice(1).join(" · "))}
                </span>
              </p>
            );
          }
        }

        if (/^#{1,6}\s/u.test(line)) {
          return (
            <p
              key={lineIndex}
              className="pt-1 font-serif text-base leading-6 tracking-[-0.01em] text-ink"
            >
              {renderInline(line.replace(/^#+\s*/u, ""))}
            </p>
          );
        }

        if (/^[-*]\s+/u.test(line)) {
          return (
            <p key={lineIndex} className="flex gap-2 text-sm leading-6 text-body">
              <span aria-hidden="true" className="mt-2.5 size-1 shrink-0 rounded-pill bg-ink" />
              <span className="min-w-0">{renderInline(line.replace(/^[-*]\s+/u, ""))}</span>
            </p>
          );
        }

        const numbered = line.match(/^(\d+)[.、]\s*(.*)$/u);
        if (numbered) {
          return (
            <p key={lineIndex} className="flex gap-2 text-sm leading-6 text-body">
              <span className="shrink-0 font-mono text-[10px] leading-6 text-muted">
                {numbered[1]}.
              </span>
              <span className="min-w-0">{renderInline(numbered[2] ?? "")}</span>
            </p>
          );
        }

        return (
          <p key={lineIndex} className="break-words text-sm leading-6 text-body">
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

function TraceDetails({ trace }: { trace: AiToolCall[] }) {
  const summary = summarizeReadOnlyTrace(trace);
  if (!summary) return null;

  return (
    <details className="group mt-3 overflow-hidden rounded-control border border-hairline bg-black/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3 shrink-0 transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 truncate">{summary}</span>
      </summary>
      <ul className="space-y-1 border-t border-hairline px-3 py-2">
        {trace.map((call, index) => (
          <li key={`${call.tool}-${index}`} className="flex gap-2">
            <span className="type-meta shrink-0 text-stone">{toolLabel(call.tool)}</span>
            <span className="type-meta min-w-0 truncate">{describePlannedCall(call).headline}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FailureCard({ failure }: { failure: AiRequestError }) {
  const copy = planFailureCopy(failure.kind);

  return (
    <div role="alert" className="mt-4 rounded-control border border-accent-red/25 bg-accent-red/5 p-4">
      <p className="text-sm font-medium text-ink">{copy.title}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{copy.description}</p>
      {copy.showAdminLink ? (
        <a
          href={adminSettingsUrl()}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-accent-blue underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        >
          打开后台系统设置
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

function ThinkingRow() {
  return (
    <p className="mt-4 flex items-center gap-2 text-xs text-muted">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      正在搜索地点、读取行程并整理计划…
    </p>
  );
}

export interface AiConsoleProps {
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceRole;
}

/**
 * The AI page body: a chat stream on the left and the confirmable plan on the
 * right. The two-phase contract is enforced here, not just documented:
 * `createAiPlan` can only ever produce a plan, and `executeAiRun` is reachable
 * exclusively from the confirmation dialog.
 */
export function AiConsole({ workspaceId, workspaceSlug, role }: AiConsoleProps) {
  const canWrite = role === "owner" || role === "admin" || role === "editor";

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<AiChatResponse | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [planFailure, setPlanFailure] = useState<AiRequestError | null>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<AiRunExecuteResponse | null>(null);
  const [submittedCalls, setSubmittedCalls] = useState<AiToolCall[]>([]);
  const [runFailure, setRunFailure] = useState<AiRequestError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const turnCounter = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const pendingPlan =
    plan !== null && result === null && plan.plannedCalls.length > 0;
  const sendIsPrimary = !pendingPlan;
  const selectedCalls = useMemo(
    () => (plan ? plan.plannedCalls.filter((_, index) => selected[index] === true) : []),
    [plan, selected],
  );

  const nextTurnId = () => {
    turnCounter.current += 1;
    return turnCounter.current;
  };

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns.length, planning, planFailure]);

  function resetPlanState() {
    setPlan(null);
    setSelected([]);
    setIdempotencyKey(null);
    setPlanFailure(null);
    setResult(null);
    setSubmittedCalls([]);
    setRunFailure(null);
    setConfirmOpen(false);
  }

  async function send() {
    const message = draft.trim();
    if (!message || !canWrite || planning || pendingPlan || executing) return;

    const userTurnId = nextTurnId();
    setDraft("");
    setPlan(null);
    setSelected([]);
    setIdempotencyKey(null);
    setPlanFailure(null);
    setResult(null);
    setSubmittedCalls([]);
    setRunFailure(null);
    setTurns((current) => [
      ...current,
      { id: userTurnId, role: "user", text: message },
    ]);
    setPlanning(true);

    try {
      const response = await createAiPlan(workspaceId, { message });
      const assistantTurnId = nextTurnId();
      setPlan(response);
      setSelected(response.plannedCalls.map(() => true));
      setIdempotencyKey(createAiIdempotencyKey());
      setTurns((current) => [
        ...current,
        {
          id: assistantTurnId,
          role: "assistant",
          text: response.message,
          trace: response.readOnlyTrace,
        },
      ]);
      setAnnouncement(
        response.plannedCalls.length === 0
          ? "计划已生成，没有需要写入的操作。"
          : `计划已生成，共 ${response.plannedCalls.length} 项操作待确认。`,
      );
    } catch (cause) {
      const failure = toAiRequestError(cause);
      setPlanFailure(failure);
      setDraft(message);
      setAnnouncement(`计划没有生成：${planFailureCopy(failure.kind).title}。`);
    } finally {
      setPlanning(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  function toggle(index: number) {
    setSelected((current) =>
      current.map((value, position) => (position === index ? !value : value)),
    );
  }

  function requestExecute() {
    if (!plan || executing || selectedCalls.length === 0) return;
    setConfirmOpen(true);
  }

  async function confirmExecute() {
    if (!plan || !idempotencyKey || executing) return;
    const calls = selectedCalls;
    if (calls.length === 0) return;

    setConfirmOpen(false);
    setExecuting(true);
    setRunFailure(null);
    setSubmittedCalls(calls);

    try {
      const response = await executeAiRun(workspaceId, plan.runId, {
        calls,
        idempotencyKey,
      });
      setResult(response);
      const succeeded = response.results.filter((item) => item.ok).length;
      const failed = response.results.length - succeeded;
      setAnnouncement(
        failed === 0
          ? `执行完成，${succeeded} 项操作已保存。`
          : `执行完成，${succeeded} 项成功，${failed} 项失败。`,
      );
    } catch (cause) {
      const failure = toAiRequestError(cause);
      setRunFailure(failure);
      setAnnouncement(`执行没有完成：${executionFailureCopy(failure.kind).title}。`);
    } finally {
      setExecuting(false);
    }
  }

  function discardPlan() {
    resetPlanState();
    setAnnouncement("已放弃这个计划，没有写入任何内容。");
  }

  function startOver() {
    resetPlanState();
    setAnnouncement("可以开始新的计划。");
  }

  const canSubmit =
    canWrite && !planning && !pendingPlan && !executing && draft.trim().length > 0;

  const composerNote = !canWrite
    ? "只有 Owner、Admin 或 Editor 可以让助手写入内容。"
    : planning
      ? "助手正在搜索与规划，请稍候。"
      : pendingPlan
        ? "先执行或放弃当前计划，再发送新的需求。"
        : `Enter 发送 · Shift + Enter 换行 · ${draft.length}/${MAX_MESSAGE_LENGTH}`;

  const placeholder = !canWrite
    ? "当前角色只能阅读工作区内容"
    : pendingPlan
      ? "先确认或放弃当前计划"
      : "例如：想去京都一周，预算 8000，喜欢古寺和咖啡馆";

  return (
    <div className="space-y-5">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {!canWrite ? (
        <p className="rounded-control border border-hairline-strong bg-surface-1 px-4 py-3 text-xs leading-5 text-muted">
          你的角色是 {role}，可以阅读工作区，但不能让 AI 写入内容。请让 Owner 或 Admin
          调整角色后再使用助手。
        </p>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <section
          aria-label="对话"
          className="flex min-w-0 flex-col overflow-hidden rounded-card border border-hairline-strong bg-surface-1"
        >
          <header className="flex shrink-0 items-end justify-between gap-3 border-b border-hairline px-4 py-4 md:px-5">
            <div>
              <p className="type-eyebrow">CONVERSATION / 只读规划</p>
              <h2 className="mt-1 font-serif text-xl leading-tight tracking-[-0.02em] text-ink">
                对话
              </h2>
            </div>
            <p className="type-meta shrink-0 pb-0.5">单次最多 8 轮工具</p>
          </header>

          <div
            ref={transcriptRef}
            className="max-h-[420px] min-h-[240px] flex-1 overflow-y-auto px-4 py-5 md:px-5"
          >
            {turns.length === 0 && !planning && !planFailure ? (
              <div className="flex min-h-[200px] flex-col justify-center">
                <p className="font-serif text-2xl leading-tight tracking-[-0.02em] text-ink">
                  先说出你的计划
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                  助手会先搜索地点、阅读已有行程，再把要执行的操作列进计划面板。你确认之前，不会写入任何内容。
                </p>
                {canWrite ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {PROMPT_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setDraft(suggestion)}
                        className="rounded-pill border border-hairline-strong bg-surface-2 px-3 py-1.5 text-left text-xs leading-5 text-body outline-none transition-colors hover:border-white/20 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {turns.map((turn) => (
              <article key={turn.id} className="mt-5 first:mt-0">
                <div className="flex items-center gap-2">
                  <span className="type-eyebrow">{turn.role === "user" ? "你" : "助手"}</span>
                  <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
                </div>
                <div className="mt-2">
                  {turn.role === "user" ? (
                    <p className="whitespace-pre-line break-words text-sm leading-6 text-ink">
                      {turn.text}
                    </p>
                  ) : turn.text.trim().length > 0 ? (
                    <FormattedMessage text={turn.text} />
                  ) : (
                    <p className="text-sm leading-6 text-muted">
                      计划已整理好，请在右侧逐条确认。
                    </p>
                  )}
                  {turn.trace && turn.trace.length > 0 ? (
                    <TraceDetails trace={turn.trace} />
                  ) : null}
                </div>
              </article>
            ))}

            {planning ? <ThinkingRow /> : null}
            {planFailure ? <FailureCard failure={planFailure} /> : null}
          </div>

          <form
            onSubmit={submit}
            className="shrink-0 border-t border-hairline p-4 md:p-5"
            aria-label="发送旅行需求"
          >
            <label htmlFor="ai-message" className="sr-only">
              旅行需求
            </label>
            <Textarea
              id="ai-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={placeholder}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={3}
              disabled={!canWrite || planning || pendingPlan}
              aria-describedby="ai-message-note"
              className="min-h-[88px]"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p id="ai-message-note" className="type-meta min-w-0">
                {composerNote}
              </p>
              <Button
                type="submit"
                variant={sendIsPrimary ? "primary" : "ghost"}
                disabled={!canSubmit}
                className="shrink-0"
              >
                <Send aria-hidden="true" className="size-3.5" />
                发送
              </Button>
            </div>
          </form>
        </section>

        <PlanPanel
          plan={plan}
          selected={selected}
          onToggle={toggle}
          onRequestExecute={requestExecute}
          onDiscard={discardPlan}
          onRestart={startOver}
          executing={executing}
          planning={planning}
          result={result}
          submittedCalls={submittedCalls}
          runFailure={runFailure}
          workspaceSlug={workspaceSlug}
        />
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认执行这些操作？</DialogTitle>
            <DialogDescription>
              确认后会立即写入工作区，而且不会自动撤销。只执行你勾选的 {selectedCalls.length}{" "}
              项。
            </DialogDescription>
          </DialogHeader>
          <ConfirmationList calls={selectedCalls} />
          <p className="mt-3 text-xs leading-5 text-muted">
            重复提交同一份计划会复用同一个请求标识，服务器不会重复创建内容。
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button type="button" variant="primary" onClick={() => void confirmExecute()}>
              确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}