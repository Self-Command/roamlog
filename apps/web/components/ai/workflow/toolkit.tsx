"use generative";

/**
 * Human-in-the-loop toolkit.
 *
 * Ported from assistant-ui `examples/with-generative-ui/app/toolkit.tsx`
 * (commit 4a0d2a5b9f04c8fb7ff9cd224827a958096b52dc, MIT):
 * `defineToolkit`, `execute: humanTool()`, and the renderer registration are
 * kept as authored upstream. The two concrete upstream examples
 * (`collect_contact`, `select_date`) are collapsed into one model-generated
 * `ask_user` schema so the assistant can ask arbitrary questions instead of a
 * hard-coded travel/contact form; `confirm_brief` is the second human gate.
 *
 * The parameter schemas come from Roamlog contracts, which are the same schemas
 * the NestJS planner validates. This is the adaptation layer: UI and transport
 * stay Roamlog, while the generative compiler and human-tool semantics remain
 * the upstream implementation.
 */

import { defineToolkit, humanTool } from "@assistant-ui/react";
import { AiAskUserArgsSchema, AiConfirmBriefArgsSchema } from "@roamlog/contracts";

import { AskUserToolUI } from "./ask-user-tool";
import { ConfirmBriefToolUI } from "./confirm-brief-tool";

export default defineToolkit({
  ask_user: {
    description:
      "Ask the user for information that is required but missing from the request. Use one generic question per missing fact; never invent travel-specific fields. Answer kinds may be text, single choice, multiple choice, date, or number.",
    parameters: AiAskUserArgsSchema,
    execute: humanTool(),
    render: AskUserToolUI,
  },
  confirm_brief: {
    description:
      "Show the user a structured requirements brief and wait for confirmation or revision. Call this before generating a plan or performing any write. Do not include unresolved questions and then proceed as if they were answered.",
    parameters: AiConfirmBriefArgsSchema,
    execute: humanTool(),
    render: ConfirmBriefToolUI,
  },
});
