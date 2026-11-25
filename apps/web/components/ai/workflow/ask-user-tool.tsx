"use client";

/**
 * Ported from assistant-ui `examples/with-generative-ui`:
 * - `contact-form-tool-ui.tsx` L18-L89: controlled answers, validation and
 *   `addResult` submission;
 * - `date-picker-tool-ui.tsx` L16-L74: native date input, min/max bounds and
 *   the submitted-result state;
 * - `app/toolkit.tsx` L10-L33: human tool arguments and result separation.
 *
 * Adaptation: both examples are composed into one generic multi-question form
 * built on the Roamlog AI Elements `Question` primitive. The upstream
 * single-tool `addResult` call is retained; the final submit is the point where
 * all fields are validated together.
 */

import {
  unstable_useInteractable,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { AI_HUMAN_CANCEL_REASON, isHumanToolCancellation } from "@roamlog/contracts";
import { Button, Input } from "@roamlog/ui";
import {
  CheckCircle2,
  CircleHelp,
  MessageSquareText,
  XCircle,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import {
  Question,
  QuestionDescription,
  QuestionInput,
  QuestionOption,
  QuestionOptions,
  QuestionPrompt,
} from "../elements/question";
import { cn } from "../cn";
import {
  ASK_USER_DRAFT_NAME,
  draftIdFor,
  useDraftScope,
} from "./draft-persistence";
import {
  ASK_USER_DRAFT_STATE_SCHEMA,
  EMPTY_ASK_USER_DRAFT,
  hasAskUserDraft,
  readAskUserDraft,
} from "./plan-draft-state";
import type {
  AskUserAnswer,
  AskUserArgs,
  AskUserQuestion,
  AskUserResult,
} from "./types";

interface QuestionState {
  readonly values: readonly string[];
  readonly text: string;
}

type QuestionStates = Readonly<Record<string, QuestionState>>;

const EMPTY_QUESTION_STATE: QuestionState = { values: [], text: "" };

function isQuestion(value: unknown): value is AskUserQuestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const question = value as Record<string, unknown>;
  return (
    typeof question.id === "string" &&
    question.id.length > 0 &&
    typeof question.prompt === "string" &&
    question.prompt.length > 0 &&
    (question.kind === "text" ||
      question.kind === "single" ||
      question.kind === "multi" ||
      question.kind === "date" ||
      question.kind === "number")
  );
}

function hasOptions(question: AskUserQuestion): boolean {
  return (
    (question.kind === "single" || question.kind === "multi") &&
    (question.options?.length ?? 0) > 0
  );
}

function isRequired(question: AskUserQuestion): boolean {
  return question.required !== false;
}

function isDateInRange(
  value: string,
  minDate: string | undefined,
  maxDate: string | undefined,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  if (minDate && value < minDate) return false;
  if (maxDate && value > maxDate) return false;
  return true;
}

function questionError(
  question: AskUserQuestion,
  state: QuestionState,
): string | null {
  const text = state.text.trim();
  const hasValues = state.values.length > 0;
  const required = isRequired(question);

  if (question.kind === "date") {
    if (!text) return required ? "请选择日期。" : null;
    return isDateInRange(text, question.minDate, question.maxDate)
      ? null
      : "日期超出允许范围。";
  }

  if (question.kind === "number") {
    if (!text) return required ? "请填写数字。" : null;
    const number = Number(text);
    if (!Number.isFinite(number)) return "请输入有效数字。";
    if (question.min !== undefined && number < question.min) {
      return `不能小于 ${String(question.min)}。`;
    }
    if (question.max !== undefined && number > question.max) {
      return `不能大于 ${String(question.max)}。`;
    }
    return null;
  }

  if (hasOptions(question)) {
    if (required && !hasValues && !text) return "请至少选择一项。";
    return null;
  }

  return required && !text ? "请填写这一项。" : null;
}

function hasAnswer(state: QuestionState): boolean {
  return state.values.length > 0 || state.text.trim().length > 0;
}

function answerFor(state: QuestionState): AskUserAnswer | null {
  if (!hasAnswer(state)) return null;
  const text = state.text.trim();
  return {
    values: [...state.values],
    ...(text.length > 0 ? { text } : {}),
  };
}

function optionLabel(question: AskUserQuestion, value: string): string {
  return question.options?.find((option) => option.value === value)?.label ?? value;
}

function answerSummary(question: AskUserQuestion, answer: AskUserAnswer | undefined): string {
  if (!answer) return "未填写";
  const parts = [
    ...answer.values.map((value) => optionLabel(question, value)),
    ...(answer.text ? [answer.text] : []),
  ];
  return parts.length > 0 ? parts.join("、") : "未填写";
}

function QuestionField({
  question,
  state,
  disabled,
  error,
  onChange,
}: {
  question: AskUserQuestion;
  state: QuestionState;
  disabled: boolean;
  error: string | null;
  onChange: (next: QuestionState) => void;
}) {
  const generatedId = useId();
  const promptId = `${generatedId}-prompt`;
  const descriptionId = `${generatedId}-description`;
  const errorId = `${generatedId}-error`;
  const fieldId = `${generatedId}-field`;
  const options = (question.options ?? []).filter(
    (option) =>
      typeof option?.value === "string" &&
      option.value.length > 0 &&
      typeof option.label === "string",
  );
  const optionsMode = hasOptions(question);
  const describedBy = [
    question.description ? descriptionId : null,
    error ? errorId : null,
  ]
    .filter((id): id is string => id !== null)
    .join(" ");

  const onQuestionValueChange = (next: { selectedValues: readonly string[]; text: string }) => {
    onChange({ values: next.selectedValues, text: next.text });
  };

  const setText = (text: string) => {
    onChange({ ...state, text });
  };

  return (
    <Question
      aria-labelledby={promptId}
      className="space-y-3! rounded-none! border-0! bg-transparent! p-0!"
      data-testid={`ask-user-question-${question.id}`}
      disabled={disabled}
      onValueChange={onQuestionValueChange}
      selectionMode={question.kind === "multi" ? "multiple" : "single"}
      value={{ selectedValues: state.values, text: state.text }}
    >
      <div>
        <QuestionPrompt id={promptId}>
          {question.prompt}
          {isRequired(question) ? (
            <span aria-hidden="true" className="ml-1 text-accent-red">
              *
            </span>
          ) : null}
        </QuestionPrompt>
        {question.description ? (
          <QuestionDescription id={descriptionId} className="mt-1">
            {question.description}
          </QuestionDescription>
        ) : null}
      </div>

      {optionsMode ? (
        <QuestionOptions aria-label={question.prompt}>
          {options.map((option) => (
            <QuestionOption
              key={option.value}
              className={cn(
                "min-h-11 justify-start px-3 py-2 text-left text-xs leading-5",
                "md:min-h-8",
              )}
              value={option.value}
            >
              <span className="min-w-0">
                <span className="block text-ink">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block font-normal text-muted">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </QuestionOption>
          ))}
        </QuestionOptions>
      ) : null}

      {question.kind === "text" || (!optionsMode && question.kind !== "date" && question.kind !== "number") ? (
        <QuestionInput
          aria-describedby={describedBy || undefined}
          aria-invalid={Boolean(error)}
          aria-label={question.prompt}
          id={fieldId}
          placeholder={question.placeholder ?? "填写你的回答"}
        />
      ) : null}

      {optionsMode && question.allowOther ? (
        <QuestionInput
          aria-describedby={describedBy || undefined}
          aria-invalid={Boolean(error)}
          aria-label={`${question.prompt}（其他）`}
          className="min-h-16"
          id={`${fieldId}-other`}
          placeholder={question.placeholder ?? "其他补充（可选）"}
        />
      ) : null}

      {question.kind === "date" ? (
        <Input
          aria-describedby={describedBy || undefined}
          aria-invalid={Boolean(error)}
          aria-label={question.prompt}
          id={fieldId}
          max={question.maxDate}
          min={question.minDate}
          onChange={(event) => setText(event.currentTarget.value)}
          type="date"
          value={state.text}
        />
      ) : null}

      {question.kind === "number" ? (
        <Input
          aria-describedby={describedBy || undefined}
          aria-invalid={Boolean(error)}
          aria-label={question.prompt}
          id={fieldId}
          inputMode="decimal"
          max={question.max}
          min={question.min}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder={question.placeholder ?? "输入数字"}
          step="any"
          type="number"
          value={state.text}
        />
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs leading-5 text-accent-red">
          {error}
        </p>
      ) : null}
    </Question>
  );
}

function SubmittedState({
  args,
  result,
  error,
}: {
  args: AskUserArgs;
  result: AskUserResult;
  error: string;
}) {
  const cancelled = isHumanToolCancellation(result);
  return (
    <section
      aria-label={cancelled ? "已取消本次提问" : "已提交的回答"}
      className={cn(
        "rounded-card border p-4",
        cancelled
          ? "border-hairline-strong bg-surface-1"
          : "border-accent-green/25 bg-accent-green/5",
      )}
      data-testid="ask-user-result"
    >
      <div className="flex items-center gap-2">
        {cancelled ? (
          <XCircle aria-hidden="true" className="size-4 text-muted" />
        ) : (
          <CheckCircle2 aria-hidden="true" className="size-4 text-accent-green" />
        )}
        <h3 className="text-sm font-medium text-ink">{args.title}</h3>
      </div>
      {cancelled ? (
        <p className="mt-2 text-xs leading-5 text-muted">
          本次提问已取消，没有生成计划，也没有写入任何内容。你可以重新描述需求。
        </p>
      ) : (
        <dl className="mt-3 space-y-2">
          {args.questions.map((question) => (
            <div
              key={question.id}
              className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
            >
              <dt className="text-xs leading-5 text-muted">{question.prompt}</dt>
              <dd className="text-xs leading-5 text-ink">
                {answerSummary(question, result.answers[question.id])}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-xs leading-5 text-accent-red">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export const AskUserToolUI: ToolCallMessagePartComponent<AskUserArgs, AskUserResult> =
  function AskUserToolUI({ args, result, status, addResult, toolCallId }) {
    const draftScope = useDraftScope();
    const [storedDraft, draftMethods] = unstable_useInteractable(ASK_USER_DRAFT_NAME, {
      description:
        "Internal persisted draft for the pending ask_user form. The model must never call the generated update tool; use ask_user instead.",
      stateSchema: ASK_USER_DRAFT_STATE_SCHEMA,
      initialState: EMPTY_ASK_USER_DRAFT,
      id: draftIdFor(draftScope, toolCallId),
    });
    const draft = useMemo(() => readAskUserDraft(storedDraft), [storedDraft]);
    const states = draft.answers;
    const attempted = draft.attempted;
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [localResult, setLocalResult] = useState<AskUserResult | null>(null);
    const questions = useMemo(
      () => (Array.isArray(args?.questions) ? args.questions.filter(isQuestion) : []),
      [args?.questions],
    );
    const title =
      typeof args?.title === "string" && args.title.trim().length > 0
        ? args.title
        : "需要你的回答";
    const intro = typeof args?.intro === "string" ? args.intro : undefined;
    const resolvedResult = result ?? localResult;
    const disabled =
      Boolean(resolvedResult) ||
      status?.type === "running" ||
      status?.type === "incomplete";

    const setStates = (
      update:
        | QuestionStates
        | ((current: QuestionStates) => QuestionStates),
    ) => {
      draftMethods.setState((value: unknown) => {
        const previous = readAskUserDraft(value);
        return {
          ...previous,
          answers:
            typeof update === "function" ? update(previous.answers) : update,
        };
      });
    };

    const setAttempted = (next: boolean) => {
      draftMethods.setState((value: unknown) => ({
        ...readAskUserDraft(value),
        attempted: next,
      }));
    };

    useEffect(() => {
      if (!resolvedResult || !hasAskUserDraft(draft)) return;
      draftMethods.setState(EMPTY_ASK_USER_DRAFT);
      void draftMethods.flush();
    }, [draft, draftMethods.flush, draftMethods.setState, resolvedResult]);

    const errors = useMemo(
      () =>
        Object.fromEntries(
          questions.map((question) => [
            question.id,
            questionError(question, states[question.id] ?? EMPTY_QUESTION_STATE),
          ]),
        ) as Record<string, string | null>,
      [questions, states],
    );
    const unanswered = questions.filter(
      (question) =>
        isRequired(question) &&
        !hasAnswer(states[question.id] ?? EMPTY_QUESTION_STATE),
    );
    const hasErrors = questions.some((question) => errors[question.id] !== null);
    const canSubmit =
      !disabled &&
      questions.length > 0 &&
      !hasErrors &&
      unanswered.length === 0;

    if (resolvedResult) {
      return (
        <SubmittedState
          args={{ title, intro, questions }}
          error={submitError ?? ""}
          result={resolvedResult}
        />
      );
    }

    const submit = () => {
      setAttempted(true);
      setSubmitError(null);
      if (!canSubmit) return;

      const answers = Object.fromEntries(
        questions.flatMap((question) => {
          const answer = answerFor(states[question.id] ?? EMPTY_QUESTION_STATE);
          return answer ? [[question.id, answer]] : [];
        }),
      ) as Record<string, AskUserAnswer>;
      const next: AskUserResult = { answers };
      setLocalResult(next);
      try {
        addResult(next);
      } catch {
        setLocalResult(null);
        setSubmitError("提交失败，请重试。");
      }
    };

    const cancel = () => {
      setSubmitError(null);
      const next: AskUserResult = {
        approved: false,
        reason: AI_HUMAN_CANCEL_REASON,
      };
      setLocalResult(next);
      try {
        addResult(next);
      } catch {
        setLocalResult(null);
        setSubmitError("取消失败，请重试。");
      }
    };

    if (questions.length === 0) {
      return (
        <section className="rounded-card border border-hairline bg-surface-1 p-4">
          <p role="alert" className="text-sm leading-6 text-accent-red">
            AI 没有提供需要回答的问题，请重试。
          </p>
        </section>
      );
    }

    return (
      <section
        aria-label={title}
        className="rounded-card border border-hairline-strong bg-surface-1"
        data-pending={status?.type === "requires-action" ? "true" : undefined}
        data-testid="ask-user-tool"
      >
        <header className="sticky top-0 z-10 border-b border-hairline bg-surface-1 px-4 py-3">
          <div className="flex items-start gap-2">
            <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-blue" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-5 text-ink">{title}</h3>
              {intro ? (
                <p className="mt-1 text-xs leading-5 text-muted">{intro}</p>
              ) : null}
            </div>
          </div>
        </header>

        <div className="space-y-4 px-4 py-4 md:max-h-[min(70vh,42rem)] md:overflow-y-auto">
          {questions.map((question) => (
            <QuestionField
              key={question.id}
              disabled={disabled}
              error={attempted || states[question.id] ? errors[question.id] ?? null : null}
              onChange={(next) =>
                setStates((current) => ({
                  ...current,
                  [question.id]: next,
                }))
              }
              question={question}
              state={states[question.id] ?? EMPTY_QUESTION_STATE}
            />
          ))}
        </div>

        <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-hairline bg-surface-1 px-4 py-3">
          <p className="text-xs leading-5 text-muted">
            {attempted && !canSubmit
              ? "请完成所有必填问题后再提交。"
              : "回答只会用于继续这次对话。"}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              disabled={disabled}
              onClick={cancel}
              size="sm"
              type="button"
              variant="ghost"
            >
              <XCircle aria-hidden="true" className="size-3.5" />
              暂不回答
            </Button>
            <Button
              disabled={disabled}
              onClick={submit}
              size="sm"
              type="button"
              variant="primary"
            >
              <MessageSquareText aria-hidden="true" className="size-3.5" />
              提交回答
            </Button>
          </div>
        </footer>
      </section>
    );
  };

AskUserToolUI.displayName = "AskUserToolUI";
