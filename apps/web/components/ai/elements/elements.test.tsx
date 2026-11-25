import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
  Question,
  QuestionActions,
  QuestionDescription,
  QuestionInput,
  QuestionOption,
  QuestionOptions,
  QuestionPrompt,
  QuestionSubmit,
} from ".";
import { ChainOfThought as ProductionChainOfThought } from "../chain-of-thought";

describe("Question", () => {
  it("collects a single option and free-form text", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <Question onSubmit={onSubmit}>
        <QuestionPrompt>目的地</QuestionPrompt>
        <QuestionDescription>选择一个方向</QuestionDescription>
        <QuestionOptions>
          <QuestionOption value="kyoto">京都</QuestionOption>
          <QuestionOption value="osaka">大阪</QuestionOption>
        </QuestionOptions>
        <QuestionInput aria-label="补充要求" placeholder="慢一点" />
        <QuestionActions>
          <QuestionSubmit>提交</QuestionSubmit>
        </QuestionActions>
      </Question>,
    );

    await user.click(screen.getByRole("radio", { name: "京都" }));
    await user.click(screen.getByRole("radio", { name: "大阪" }));
    expect(screen.getByRole("radio", { name: "大阪" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "京都" })).toHaveAttribute("aria-checked", "false");

    await user.type(screen.getByRole("textbox", { name: "补充要求" }), "慢一点");
    await user.click(screen.getByRole("button", { name: "提交" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { selectedValues: ["osaka"], text: "慢一点" },
      expect.any(Object),
    );
  });

  it("supports multiple selections", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <Question selectionMode="multiple" onSubmit={onSubmit}>
        <QuestionOptions>
          <QuestionOption value="temples">古寺</QuestionOption>
          <QuestionOption value="coffee">咖啡</QuestionOption>
        </QuestionOptions>
        <QuestionSubmit>继续</QuestionSubmit>
      </Question>,
    );

    await user.click(screen.getByRole("checkbox", { name: "古寺" }));
    await user.click(screen.getByRole("checkbox", { name: "咖啡" }));
    await user.click(screen.getByRole("button", { name: "继续" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { selectedValues: ["temples", "coffee"], text: undefined },
      expect.any(Object),
    );
  });

  it("keeps every control disabled and blocks empty submits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <Question disabled onSubmit={onSubmit}>
        <QuestionOption value="kyoto">京都</QuestionOption>
        <QuestionInput aria-label="补充要求" />
        <QuestionSubmit>提交</QuestionSubmit>
      </Question>,
    );

    expect(screen.getByRole("radio", { name: "京都" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "补充要求" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "京都" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Plan", () => {
  it("opens and closes its content without losing the header", async () => {
    const user = userEvent.setup();

    render(
      <Plan>
        <PlanHeader>
          <PlanTitle>京都慢行</PlanTitle>
          <PlanDescription>四天三晚</PlanDescription>
          <PlanAction>
            <PlanTrigger />
          </PlanAction>
        </PlanHeader>
        <PlanContent>逐日安排</PlanContent>
      </Plan>,
    );

    expect(screen.queryByText("逐日安排")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "展开或收起计划" });
    await user.click(trigger);
    expect(screen.getByText("逐日安排")).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByText("逐日安排")).not.toBeInTheDocument();
  });
});

describe("ChainOfThought", () => {
  it("uses one implementation for production and the Elements surface", () => {
    expect(ProductionChainOfThought).toBe(ChainOfThought);
  });

  it("preserves controlled open state, step status and search results", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <ChainOfThought onOpenChange={onOpenChange}>
        <ChainOfThoughtHeader>推理过程</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep status="active" label="检索地点" />
          <ChainOfThoughtSearchResults>
            <ChainOfThoughtSearchResult>清水寺</ChainOfThoughtSearchResult>
          </ChainOfThoughtSearchResults>
        </ChainOfThoughtContent>
      </ChainOfThought>,
    );

    expect(screen.queryByText("检索地点")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "推理过程" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("检索地点")).toBeInTheDocument();
    expect(screen.getByText("清水寺")).toBeInTheDocument();
  });
});

describe("Confirmation", () => {
  const approval = { id: "approval-1" };

  it("shows request actions only while approval is requested", () => {
    render(
      <Confirmation approval={approval} state="approval-requested">
        <ConfirmationTitle>需要确认</ConfirmationTitle>
        <ConfirmationRequest>是否继续？</ConfirmationRequest>
        <ConfirmationActions>
          <ConfirmationAction>允许</ConfirmationAction>
        </ConfirmationActions>
        <ConfirmationAccepted>已允许</ConfirmationAccepted>
        <ConfirmationRejected>已拒绝</ConfirmationRejected>
      </Confirmation>,
    );

    expect(screen.getByText("是否继续？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "允许" })).toBeInTheDocument();
    expect(screen.queryByText("已允许")).not.toBeInTheDocument();
    expect(screen.queryByText("已拒绝")).not.toBeInTheDocument();
  });

  it.each(["approval-responded", "output-denied", "output-available"] as const)(
    "shows accepted content in %s after approval",
    (state) => {
      render(
        <Confirmation approval={{ id: "a", approved: true }} state={state}>
          <ConfirmationTitle>需要确认</ConfirmationTitle>
          <ConfirmationAccepted>已允许</ConfirmationAccepted>
          <ConfirmationRejected>已拒绝</ConfirmationRejected>
        </Confirmation>,
      );

      expect(screen.getByText("已允许")).toBeInTheDocument();
      expect(screen.queryByText("已拒绝")).not.toBeInTheDocument();
    },
  );

  it.each(["approval-responded", "output-denied", "output-available"] as const)(
    "shows rejected content in %s after rejection",
    (state) => {
      render(
        <Confirmation approval={{ id: "a", approved: false }} state={state}>
          <ConfirmationTitle>需要确认</ConfirmationTitle>
          <ConfirmationAccepted>已允许</ConfirmationAccepted>
          <ConfirmationRejected>已拒绝</ConfirmationRejected>
        </Confirmation>,
      );

      expect(screen.getByText("已拒绝")).toBeInTheDocument();
      expect(screen.queryByText("已允许")).not.toBeInTheDocument();
    },
  );

  it("renders nothing while the tool input is still streaming", () => {
    const { container } = render(
      <Confirmation approval={approval} state="input-streaming">
        <ConfirmationTitle>需要确认</ConfirmationTitle>
      </Confirmation>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
