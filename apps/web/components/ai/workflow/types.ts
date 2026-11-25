/**
 * Human-in-the-loop tool contracts for the assistant UI.
 *
 * The shape follows assistant-ui's `ToolApprovalQuestion` / `ToolApprovalAnswer`
 * model (MIT, commit 4a0d2a5b9f04c8fb7ff9cd224827a958096b52dc) while keeping
 * the tool arguments generic: `ask_user` never hard-codes travel fields.
 */

import type {
  AiAskUserResult,
  AiConfirmBriefResult,
  AiHumanAnswer,
} from "@roamlog/contracts";

export const AI_HUMAN_TOOL_NAMES = ["ask_user", "confirm_brief"] as const;
export type AiHumanToolName = (typeof AI_HUMAN_TOOL_NAMES)[number];

export type AskUserQuestionKind = "text" | "single" | "multi" | "date" | "number";

export interface AskUserQuestionOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}

export interface AskUserQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly description?: string;
  readonly kind: AskUserQuestionKind;
  /**
   * Required unless explicitly `false`: the tool cannot resume until every
   * required question has an answer. Optional questions are omitted from the
   * result when the user leaves them blank.
   */
  readonly required?: boolean;
  /** Shows a free-form field in addition to the option buttons. */
  readonly allowOther?: boolean;
  readonly options?: readonly AskUserQuestionOption[];
  readonly placeholder?: string;
  /** Inclusive bounds for `kind: "number"`. */
  readonly min?: number;
  readonly max?: number;
  /** Inclusive ISO date bounds for `kind: "date"` (`YYYY-MM-DD`). */
  readonly minDate?: string;
  readonly maxDate?: string;
}

export interface AskUserArgs {
  readonly title: string;
  readonly intro?: string;
  readonly questions: readonly AskUserQuestion[];
}

export type AskUserAnswer = AiHumanAnswer;

export type AskUserResult = AiAskUserResult;

export interface ConfirmBriefArgs {
  readonly title: string;
  readonly summary: string;
  readonly constraints?: readonly string[];
  readonly assumptions?: readonly string[];
  /**
   * If non-empty, the UI disables direct confirmation: the user must edit the
   * brief first. This prevents an unresolved question from silently becoming
   * an assumption.
   */
  readonly openQuestions?: readonly string[];
}

export type ConfirmBriefResult = AiConfirmBriefResult;
