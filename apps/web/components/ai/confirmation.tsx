"use client";

/**
 * Application-level entry point for the AI Elements Confirmation primitives.
 *
 * The full port lives in `elements/confirmation.tsx`; keeping this facade
 * stable lets Roamlog features consume the same approval state machine without
 * importing an implementation path directly.
 */

export {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "./elements/confirmation";
export type { ToolUiState } from "./elements/confirmation";
