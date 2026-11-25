"use client";

/**
 * Brief confirmation surface.
 *
 * The decision/acknowledgement branches use the AI Elements
 * `confirmation.tsx` primitives ported in `apps/web/components/ai/elements`
 * (Apache-2.0, vercel/ai-elements @ ca8be600). The editable revision branch
 * follows the same `addResult` contract as the assistant-ui human tools.
 */

import {
  unstable_useInteractable,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import {
  AI_HUMAN_CANCEL_REASON,
  confirmBriefRevisionText,
  isConfirmBriefConfirmed,
  isHumanToolCancellation,
} from "@roamlog/contracts";
import { Textarea } from "@roamlog/ui";
import { CheckCircle2, ListChecks, PencilLine, XCircle } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "../elements/confirmation";
import {
  CONFIRM_BRIEF_DRAFT_NAME,
  draftIdFor,
  useDraftScope,
} from "./draft-persistence";
import {
  CONFIRM_BRIEF_DRAFT_STATE_SCHEMA,
  EMPTY_CONFIRM_BRIEF_DRAFT,
  hasConfirmBriefDraft,
  readConfirmBriefDraft,
} from "./plan-draft-state";
import type { ConfirmBriefArgs, ConfirmBriefResult } from "./types";

function BriefList({ title, items }: { title: string; items: readonly string[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="min-w-0">
      <h4 className="type-eyebrow">{title}</h4>
      <ul className="mt-1.5 space-y-1 text-xs leading-5 text-body">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-stone" />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const ConfirmBriefToolUI: ToolCallMessagePartComponent<
  ConfirmBriefArgs,
  ConfirmBriefResult
> = function ConfirmBriefToolUI({ args, result, status, addResult, toolCallId }) {
  const [localResult, setLocalResult] = useState<ConfirmBriefResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftScope = useDraftScope();
  const [storedDraft, draftMethods] = unstable_useInteractable(
    CONFIRM_BRIEF_DRAFT_NAME,
    {
      description:
        "Internal persisted draft for the pending confirm_brief form. The model must never call the generated update tool; use confirm_brief instead.",
      stateSchema: CONFIRM_BRIEF_DRAFT_STATE_SCHEMA,
      initialState: EMPTY_CONFIRM_BRIEF_DRAFT,
      id: draftIdFor(draftScope, toolCallId),
    },
  );
  const draft = useMemo(
    () => readConfirmBriefDraft(storedDraft),
    [storedDraft],
  );
  const { revising, revision } = draft;
  const id = useId();
  const resolved = result ?? localResult;
  const title =
    typeof args?.title === "string" && args.title.trim().length > 0
      ? args.title
      : "确认需求摘要";
  const summary = typeof args?.summary === "string" ? args.summary : "";
  const constraints = Array.isArray(args?.constraints) ? args.constraints : [];
  const assumptions = Array.isArray(args?.assumptions) ? args.assumptions : [];
  const openQuestions = Array.isArray(args?.openQuestions) ? args.openQuestions : [];
  const hasSummary = summary.trim().length > 0;
  const disabled =
    Boolean(resolved) || status?.type === "running" || status?.type === "incomplete";

  const setRevising = (next: boolean) => {
    draftMethods.setState((value: unknown) => ({
      ...readConfirmBriefDraft(value),
      revising: next,
      revision: next ? readConfirmBriefDraft(value).revision : "",
    }));
  };

  const setRevision = (next: string) => {
    draftMethods.setState((value: unknown) => ({
      ...readConfirmBriefDraft(value),
      revision: next,
    }));
  };

  useEffect(() => {
    if (!resolved || !hasConfirmBriefDraft(draft)) return;
    draftMethods.setState(EMPTY_CONFIRM_BRIEF_DRAFT);
    void draftMethods.flush();
  }, [draft, draftMethods.flush, draftMethods.setState, resolved]);

  const submit = (next: ConfirmBriefResult) => {
    setError(null);
    setLocalResult(next);
    try {
      addResult(next);
    } catch {
      setLocalResult(null);
      setError("提交失败，请重试。");
    }
  };

  const approval = resolved
    ? { id, approved: isConfirmBriefConfirmed(resolved) }
    : { id };
  const state = resolved ? "approval-responded" : "approval-requested";
  const cancelled = resolved ? isHumanToolCancellation(resolved) : false;
  const revisionText = resolved ? confirmBriefRevisionText(resolved) : null;

  return (
    <Confirmation
      approval={approval}
      className="scroll-mt-4 border-hairline-strong md:max-h-[min(72dvh,44rem)] md:overflow-y-auto"
      data-pending={status?.type === "requires-action" ? "true" : undefined}
      data-testid="confirm-brief-tool"
      state={state}
    >
      <ConfirmationTitle className="sr-only">需求摘要确认</ConfirmationTitle>
      <ConfirmationRequest>
        <div className="flex items-start gap-2">
          <ListChecks aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-blue" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-5 text-ink">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              请确认下面的需求摘要。确认后才会开始生成计划。
            </p>
          </div>
        </div>

        <section className="rounded-control border border-hairline bg-surface-0/50 px-3 py-3">
          <h4 className="type-eyebrow">需求摘要</h4>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-ink">
            {summary || "AI 还没有提供需求摘要，请继续修改或重试。"}
          </p>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <BriefList title="明确约束" items={constraints} />
          <BriefList title="AI 假设" items={assumptions} />
        </div>

        {openQuestions.length > 0 ? (
          <section
            aria-label="仍需确认的问题"
            className="rounded-control border border-accent-amber/30 bg-accent-amber/5 px-3 py-2.5"
          >
            <h4 className="type-eyebrow text-accent-amber">仍需确认</h4>
            <ul className="mt-1.5 space-y-1 text-xs leading-5 text-body">
              {openQuestions.map((question, index) => (
                <li key={`${question}-${index}`}>{question}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs leading-5 text-muted">
              请先继续修改并补齐这些信息，不能直接生成计划。
            </p>
          </section>
        ) : null}

        {revising ? (
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink" htmlFor={`${id}-revision`}>
              怎么修改这份摘要？
            </label>
            <Textarea
              id={`${id}-revision`}
              onChange={(event) => setRevision(event.currentTarget.value)}
              placeholder="例如：预算改成 5000，取消大阪，增加一天休息。"
              value={revision}
            />
            {error ? (
              <p role="alert" className="text-xs text-accent-red">
                {error}
              </p>
            ) : null}
            <ConfirmationActions>
              <ConfirmationAction
                onClick={() => {
                  setRevising(false);
                  setRevision("");
                  setError(null);
                }}
                variant="outline"
              >
                返回确认
              </ConfirmationAction>
              <ConfirmationAction
                disabled={revision.trim().length === 0}
                onClick={() => submit({ approved: false, reason: revision.trim() })}
              >
                提交修改
              </ConfirmationAction>
            </ConfirmationActions>
          </div>
        ) : (
          <>
            {error ? (
              <p role="alert" className="text-xs text-accent-red">
                {error}
              </p>
            ) : null}
            <ConfirmationActions className="flex-wrap">
              <ConfirmationAction
                disabled={disabled}
                onClick={() =>
                  submit({ approved: false, reason: AI_HUMAN_CANCEL_REASON })
                }
                variant="ghost"
              >
                <XCircle aria-hidden="true" className="size-3.5" />
                取消本次
              </ConfirmationAction>
              <ConfirmationAction
                disabled={disabled}
                onClick={() => setRevising(true)}
                variant="outline"
              >
                <PencilLine aria-hidden="true" className="size-3.5" />
                继续修改
              </ConfirmationAction>
              <ConfirmationAction
                disabled={disabled || openQuestions.length > 0 || !hasSummary}
                onClick={() => submit({ approved: true })}
              >
                确认并生成计划
              </ConfirmationAction>
            </ConfirmationActions>
          </>
        )}
      </ConfirmationRequest>

      <ConfirmationAccepted>
        <div className="flex items-center gap-2 text-sm text-ink">
          <CheckCircle2 aria-hidden="true" className="size-4 text-accent-green" />
          已确认需求摘要，正在生成计划。
        </div>
      </ConfirmationAccepted>

      <ConfirmationRejected>
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm text-accent-amber">
            {cancelled ? (
              <XCircle aria-hidden="true" className="size-4" />
            ) : (
              <PencilLine aria-hidden="true" className="size-4" />
            )}
            {cancelled ? "已取消需求确认" : "已提交修改意见"}
          </p>
          {cancelled ? (
            <p className="text-xs leading-5 text-muted">
              没有生成计划，也没有写入任何内容。你可以重新发起需求。
            </p>
          ) : revisionText ? (
            <p className="whitespace-pre-wrap text-xs leading-5 text-muted">
              {revisionText}
            </p>
          ) : null}
        </div>
      </ConfirmationRejected>
    </Confirmation>
  );
};

ConfirmBriefToolUI.displayName = "ConfirmBriefToolUI";
