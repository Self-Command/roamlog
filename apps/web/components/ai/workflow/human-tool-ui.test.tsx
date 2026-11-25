import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithDraftRuntime } from "./__tests__/draft-test-runtime";
import { AskUserToolUI } from "./ask-user-tool";
import { ConfirmBriefToolUI } from "./confirm-brief-tool";
import type { AskUserArgs, ConfirmBriefArgs } from "./types";

function render(ui: ReactElement) {
  return renderWithDraftRuntime(ui);
}

type AskProps = ComponentProps<typeof AskUserToolUI>;
type BriefProps = ComponentProps<typeof ConfirmBriefToolUI>;

function askProps(
  args: AskUserArgs,
  options: {
    result?: AskProps["result"];
    status?: AskProps["status"];
    addResult?: AskProps["addResult"];
    toolCallId?: string;
  } = {},
): AskProps {
  return {
    args,
    result: options.result,
    status: options.status ?? { type: "requires-action", reason: "tool-calls" },
    addResult: options.addResult ?? vi.fn(),
    toolCallId: options.toolCallId ?? "ask-tool-1",
  } as unknown as AskProps;
}

function briefProps(
  args: ConfirmBriefArgs,
  options: {
    result?: BriefProps["result"];
    status?: BriefProps["status"];
    addResult?: BriefProps["addResult"];
    toolCallId?: string;
  } = {},
): BriefProps {
  return {
    args,
    result: options.result,
    status: options.status ?? { type: "requires-action", reason: "tool-calls" },
    addResult: options.addResult ?? vi.fn(),
    toolCallId: options.toolCallId ?? "brief-tool-1",
  } as unknown as BriefProps;
}

const genericQuestions: AskUserArgs = {
  title: "补充出行需求",
  intro: "这些信息会直接影响方案。",
  questions: [
    {
      id: "destination",
      prompt: "目的地",
      description: "填写城市或区域",
      kind: "text",
      placeholder: "例如：京都",
    },
    {
      id: "pace",
      prompt: "节奏",
      kind: "single",
      options: [
        { label: "轻松", value: "slow", description: "每天 1-2 个重点" },
        { label: "紧凑", value: "fast" },
      ],
    },
    {
      id: "interests",
      prompt: "偏好",
      kind: "multi",
      options: [
        { label: "古寺", value: "temples" },
        { label: "咖啡", value: "coffee" },
      ],
    },
  ],
};

describe("AskUserToolUI", () => {
  it("collects a text answer, one single choice, and multiple choices", async () => {
    const user = userEvent.setup();
    const addResult = vi.fn();
    render(<AskUserToolUI {...askProps(genericQuestions, { addResult })} />);

    expect(screen.getByTestId("ask-user-tool")).toHaveAttribute("data-pending", "true");
    await user.type(screen.getByLabelText("目的地"), "京都");
    await user.click(screen.getByRole("radio", { name: /轻松/u }));
    await user.click(screen.getByRole("checkbox", { name: "古寺" }));
    await user.click(screen.getByRole("checkbox", { name: "咖啡" }));
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    expect(addResult).toHaveBeenCalledWith({
      answers: {
        destination: { values: [], text: "京都" },
        pace: { values: ["slow"] },
        interests: { values: ["temples", "coffee"] },
      },
    });
    expect(screen.getByTestId("ask-user-result")).toHaveTextContent("京都");
    expect(screen.getByTestId("ask-user-result")).toHaveTextContent("轻松");
    expect(screen.getByTestId("ask-user-result")).toHaveTextContent("古寺、咖啡");
  });

  it("lets the user dismiss the request without filling every required field", async () => {
    const user = userEvent.setup();
    const addResult = vi.fn();
    render(<AskUserToolUI {...askProps(genericQuestions, { addResult })} />);

    await user.click(screen.getByRole("button", { name: "暂不回答" }));

    expect(addResult).toHaveBeenCalledWith({
      approved: false,
      reason: "user_cancelled",
    });
    expect(screen.getByTestId("ask-user-result")).toHaveTextContent(
      "本次提问已取消",
    );
    expect(screen.getByTestId("ask-user-result")).toHaveTextContent(
      "没有生成计划",
    );
  });

  it("blocks submission when required answers are missing and explains the errors", async () => {
    const user = userEvent.setup();
    const addResult = vi.fn();
    render(<AskUserToolUI {...askProps(genericQuestions, { addResult })} />);

    await user.click(screen.getByRole("button", { name: "提交回答" }));

    expect(addResult).not.toHaveBeenCalled();
    expect(screen.getByText("请填写这一项。")).toBeInTheDocument();
    expect(screen.getAllByText("请至少选择一项。")).toHaveLength(2);
    expect(screen.queryByTestId("ask-user-result")).not.toBeInTheDocument();
  });

  it("requires a valid date and number with inclusive bounds", async () => {
    const user = userEvent.setup();
    const addResult = vi.fn();
    const args: AskUserArgs = {
      title: "确认出发信息",
      questions: [
        {
          id: "depart",
          prompt: "出发日期",
          kind: "date",
          minDate: "2027-04-01",
          maxDate: "2027-04-30",
        },
        {
          id: "budget",
          prompt: "预算",
          kind: "number",
          min: 100,
          max: 10000,
        },
      ],
    };
    render(<AskUserToolUI {...askProps(args, { addResult })} />);

    fireEvent.change(screen.getByLabelText("出发日期"), {
      target: { value: "2027-03-31" },
    });
    fireEvent.change(screen.getByLabelText("预算"), {
      target: { value: "50" },
    });
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    expect(addResult).not.toHaveBeenCalled();
    expect(screen.getByText("日期超出允许范围。")).toBeInTheDocument();
    expect(screen.getByText("不能小于 100。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("出发日期"), {
      target: { value: "2027-04-02" },
    });
    fireEvent.change(screen.getByLabelText("预算"), {
      target: { value: "8000" },
    });
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    expect(addResult).toHaveBeenCalledWith({
      answers: {
        depart: { values: [], text: "2027-04-02" },
        budget: { values: [], text: "8000" },
      },
    });
  });

  it("accepts an optional free-form answer alongside options", async () => {
    const user = userEvent.setup();
    const addResult = vi.fn();
    const args: AskUserArgs = {
      title: "同行人",
      questions: [
        {
          id: "party",
          prompt: "同行人",
          kind: "single",
          allowOther: true,
          options: [{ label: "情侣", value: "couple" }],
          placeholder: "补充说明",
        },
      ],
    };
    render(<AskUserToolUI {...askProps(args, { addResult })} />);

    await user.click(screen.getByRole("radio", { name: "情侣" }));
    await user.type(screen.getByLabelText("同行人（其他）"), "带一名儿童");
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    expect(addResult).toHaveBeenCalledWith({
      answers: {
        party: { values: ["couple"], text: "带一名儿童" },
      },
    });
  });

  it("renders the submitted answers instead of an empty form", () => {
    render(
      <AskUserToolUI
        {...askProps(genericQuestions, {
          result: {
            answers: {
              destination: { values: [], text: "大阪" },
              pace: { values: ["fast"] },
              interests: { values: ["coffee"] },
            },
          },
        })}
      />,
    );

    expect(screen.getByTestId("ask-user-result")).toHaveTextContent("大阪");
    expect(screen.queryByLabelText("目的地")).not.toBeInTheDocument();
  });

  it("explains an invalid empty question list instead of rendering a false form", () => {
    render(
      <AskUserToolUI
        {...askProps({ title: "缺少问题", questions: [] })}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "AI 没有提供需要回答的问题，请重试。",
    );
  });
});

describe("ConfirmBriefToolUI", () => {
  const brief: ConfirmBriefArgs = {
    title: "确认旅行需求",
    summary: "2027 年 4 月去京都，两个人，预算 8000 元。",
    constraints: ["不安排大阪"],
    assumptions: ["从上海出发"],
  };

  it("shows the brief and submits an explicit confirmation", async () => {
    const user = userEvent.setup();
    const addResult = vi.fn();
    render(<ConfirmBriefToolUI {...briefProps(brief, { addResult })} />);

    expect(screen.getByTestId("confirm-brief-tool")).toHaveAttribute(
      "data-pending",
      "true",
    );
    expect(screen.getByTestId("confirm-brief-tool")).toHaveTextContent(
      "2027 年 4 月去京都",
    );
    expect(screen.getByText("从上海出发")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认并生成计划" }));

    expect(addResult).toHaveBeenCalledWith({ approved: true });
    expect(screen.getByText("已确认需求摘要，正在生成计划。")).toBeInTheDocument();
  });

  it("lets the user cancel the brief without generating a plan", async () => {
    const user = userEvent.setup();
    const addResult = vi.fn();
    render(<ConfirmBriefToolUI {...briefProps(brief, { addResult })} />);

    await user.click(screen.getByRole("button", { name: "取消本次" }));

    expect(addResult).toHaveBeenCalledWith({
      approved: false,
      reason: "user_cancelled",
    });
    expect(screen.getByText("已取消需求确认")).toBeInTheDocument();
    expect(screen.getByText(/没有生成计划/u)).toBeInTheDocument();
  });

  it("requires an edit instruction before submitting a revision", async () => {
    const user = userEvent.setup();
    const addResult = vi.fn();
    render(<ConfirmBriefToolUI {...briefProps(brief, { addResult })} />);

    await user.click(screen.getByRole("button", { name: "继续修改" }));
    const revision = screen.getByLabelText("怎么修改这份摘要？");
    expect(screen.getByRole("button", { name: "提交修改" })).toBeDisabled();

    await user.type(revision, "预算改成 5000，不去大阪。");
    await user.click(screen.getByRole("button", { name: "提交修改" }));

    expect(addResult).toHaveBeenCalledWith({
      approved: false,
      reason: "预算改成 5000，不去大阪。",
    });
    expect(screen.getByText("已提交修改意见")).toBeInTheDocument();
  });

  it("disables confirmation while open questions remain", () => {
    render(
      <ConfirmBriefToolUI
        {...briefProps({
          ...brief,
          openQuestions: ["是否需要预约寺庙"],
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "确认并生成计划" })).toBeDisabled();
    expect(screen.getByText("是否需要预约寺庙")).toBeInTheDocument();
  });
});
