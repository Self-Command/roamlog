import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import {
  SearchableCombobox,
  type ComboboxOption,
  type ComboboxSearch,
} from "../searchable-combobox";

const OPTION: ComboboxOption = { id: "photon:1", label: "京都", description: "city · 日本", meta: "JP" };
const SECOND: ComboboxOption = { id: "photon:2", label: "奈良", description: "city · 日本", meta: "JP" };

interface HarnessProps {
  search: ComboboxSearch;
  allowManual?: boolean;
  onManual?: (query: string) => void;
  onSelect?: (option: ComboboxOption) => void;
  listFooter?: React.ReactNode;
}

function Harness({ search, allowManual = false, onManual, onSelect, listFooter }: HarnessProps) {
  const [value, setValue] = React.useState("");
  return (
    <SearchableCombobox
      label="搜索地点"
      value={value}
      onValueChange={setValue}
      onSelect={onSelect ?? (() => undefined)}
      onManual={onManual}
      search={search}
      allowManual={allowManual}
      debounceMs={0}
      listFooter={listFooter}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  // Failure paths log the raw exception for diagnostics; keep test output clean.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SearchableCombobox states", () => {
  it("loading: announces progress while the search is in flight", async () => {
    const pending = deferred<{ items: ComboboxOption[] }>();
    const search = vi.fn<ComboboxSearch>(() => pending.promise);
    const user = userEvent.setup();
    render(<Harness search={search} />);

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "京都");

    expect(await screen.findByText("正在搜索…")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true");

    pending.resolve({ items: [OPTION] });
    expect(await screen.findByRole("option", { name: /京都/ })).toBeInTheDocument();
    expect(screen.queryByText("正在搜索…")).not.toBeInTheDocument();
  });

  it("empty: explains that nothing matched", async () => {
    const search = vi.fn<ComboboxSearch>().mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    render(<Harness search={search} />);

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "火星");

    expect(await screen.findByText("没有匹配的结果")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith("火星", expect.objectContaining({ signal: expect.anything() }));
  });

  it("error: shows fixed copy instead of the raw exception and retries the same query", async () => {
    const search = vi
      .fn<ComboboxSearch>()
      .mockRejectedValueOnce(new ApiError(500, "API request /v1/places/search failed with status 500"))
      .mockResolvedValue({ items: [OPTION] });
    const user = userEvent.setup();
    render(<Harness search={search} />);

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "京都");

    expect(await screen.findByText("搜索失败，请重试，或直接输入内容。")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).not.toHaveTextContent(/500|\/v1\//);
    const retry = screen.getByRole("button", { name: "重试" });

    await user.click(retry);

    expect(await screen.findByRole("option", { name: /京都/ })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("error: keeps the manual fallback clickable after the search fails", async () => {
    const onManual = vi.fn<(query: string) => void>();
    const search = vi
      .fn<ComboboxSearch>()
      .mockRejectedValue(new ApiError(500, "API request /v1/places/search failed with status 500"));
    const user = userEvent.setup();
    render(<Harness search={search} allowManual onManual={onManual} />);

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "乡下小镇");

    expect(await screen.findByText("搜索失败，请重试，或直接输入内容。")).toBeInTheDocument();
    const manual = await screen.findByRole("option", { name: "使用「乡下小镇」" });

    await user.click(manual);

    expect(onManual).toHaveBeenCalledWith("乡下小镇");
  });

  it("error: Enter selects the manual fallback", async () => {
    const onManual = vi.fn<(query: string) => void>();
    const search = vi
      .fn<ComboboxSearch>()
      .mockRejectedValue(new ApiError(500, "API request /v1/places/search failed with status 500"));
    const user = userEvent.setup();
    render(<Harness search={search} allowManual onManual={onManual} />);

    const input = screen.getByRole("combobox", { name: "搜索地点" });
    await user.type(input, "乡下小镇");
    await screen.findByRole("option", { name: "使用「乡下小镇」" });

    await user.keyboard("{Enter}");

    expect(onManual).toHaveBeenCalledWith("乡下小镇");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("rate-limited: keeps the retry hint and the manual fallback", async () => {
    const onManual = vi.fn<(query: string) => void>();
    const rateLimited = Object.assign(new Error("Place search is rate limited. Retry in 12s."), {
      status: 429,
      retryAfterSeconds: 12,
    });
    const search = vi.fn<ComboboxSearch>().mockRejectedValue(rateLimited);
    const user = userEvent.setup();
    render(<Harness search={search} allowManual onManual={onManual} />);

    const input = screen.getByRole("combobox", { name: "搜索地点" });
    await user.type(input, "乡下小镇");

    expect(await screen.findByText("请求过于频繁，请等待约 12 秒后重试。")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).not.toHaveTextContent("rate limited");
    await screen.findByRole("option", { name: "使用「乡下小镇」" });
    await user.keyboard("{Enter}");

    expect(onManual).toHaveBeenCalledWith("乡下小镇");
  });

  it("error: never renders HTTP status, request paths or parser output", async () => {
    const search = vi
      .fn<ComboboxSearch>()
      .mockRejectedValue(
        new ApiError(500, 'Unexpected token \'I\', "Internal S"...'),
      );
    const user = userEvent.setup();
    render(
      <Harness
        search={search}
        allowManual
        onManual={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "乡下小镇");
    await screen.findByRole("option", { name: "使用「乡下小镇」" });

    const listbox = screen.getByRole("listbox");
    expect(listbox).not.toHaveTextContent(/500|\/v1\/|Unexpected token|JSON/);
    expect(console.warn).toHaveBeenCalledWith(
      "SearchableCombobox: search request failed",
      expect.any(ApiError),
    );
  });

  it("error: maps classified failures onto fixed user copy", async () => {
    const timeout = Object.assign(new Error("request aborted by timeout"), {
      name: "TimeoutError",
    });
    const search = vi.fn<ComboboxSearch>().mockRejectedValue(timeout);
    const user = userEvent.setup();
    render(<Harness search={search} />);

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "京都");

    expect(await screen.findByText("搜索超时，请重试，或直接输入内容。")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).not.toHaveTextContent("request aborted by timeout");
  });

  it("degraded: tells the person they can type the place manually", async () => {
    const search = vi.fn<ComboboxSearch>().mockResolvedValue({ items: [], degraded: true });
    const user = userEvent.setup();
    render(<Harness search={search} />);

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "金泽");

    expect(await screen.findByText("搜索服务暂时降级，可手动填写。")).toBeInTheDocument();
  });

  it("manual fallback: offers the typed text as an option and reports it", async () => {
    const onManual = vi.fn<(query: string) => void>();
    const search = vi.fn<ComboboxSearch>().mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    render(<Harness search={search} allowManual onManual={onManual} />);

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "乡下小镇");
    const manual = await screen.findByRole("option", { name: "使用「乡下小镇」" });

    await user.click(manual);

    expect(onManual).toHaveBeenCalledWith("乡下小镇");
    expect(screen.queryByText("没有匹配的结果")).not.toBeInTheDocument();
  });

  it("does not query below the minimum length and supports keyboard selection", async () => {
    const onSelect = vi.fn<(option: ComboboxOption) => void>();
    const search = vi.fn<ComboboxSearch>().mockResolvedValue({ items: [OPTION] });
    const user = userEvent.setup();
    render(<Harness search={search} onSelect={onSelect} />);

    const input = screen.getByRole("combobox", { name: "搜索地点" });
    await user.type(input, "京");
    await waitFor(() => expect(search).not.toHaveBeenCalled());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.type(input, "都");
    await screen.findByRole("option", { name: /京都/ });
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledWith(OPTION);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("renders the list footer as a described sibling of the listbox, not as an option", async () => {
    const search = vi.fn<ComboboxSearch>().mockResolvedValue({ items: [OPTION, SECOND] });
    const user = userEvent.setup();
    render(
      <Harness
        search={search}
        listFooter={<span>Powered by Geoapify · © OpenStreetMap contributors</span>}
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "京都");
    const listbox = await screen.findByRole("listbox");
    const footerText = screen.getByText("Powered by Geoapify · © OpenStreetMap contributors");
    const footer = footerText.parentElement!;

    // The footer lives beside the listbox, not inside it.
    expect(listbox).not.toContainElement(footerText);
    expect(footer.parentElement).toBe(listbox.parentElement);
    expect(listbox.nextElementSibling).toBe(footer);

    // …and is wired up for assistive technology without becoming an option.
    expect(listbox).toHaveAttribute("aria-describedby", footer.id);
    expect(within(listbox).getAllByRole("option")).toHaveLength(2);
  });

  it("keeps the footer out of arrow-key indexing", async () => {
    const onSelect = vi.fn<(option: ComboboxOption) => void>();
    const search = vi.fn<ComboboxSearch>().mockResolvedValue({ items: [OPTION, SECOND] });
    const user = userEvent.setup();
    render(
      <Harness
        search={search}
        onSelect={onSelect}
        listFooter={<span>Powered by Geoapify</span>}
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "京都");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    // Index 1 is the second real option; a footer in the list would shift this.
    expect(onSelect).toHaveBeenCalledWith(SECOND);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("adds no footer DOM and no aria-describedby when the prop is omitted", async () => {
    const search = vi.fn<ComboboxSearch>().mockResolvedValue({ items: [OPTION] });
    const user = userEvent.setup();
    render(<Harness search={search} />);

    await user.type(screen.getByRole("combobox", { name: "搜索地点" }), "京都");
    const listbox = await screen.findByRole("listbox");

    expect(listbox).not.toHaveAttribute("aria-describedby");
    expect(listbox.nextElementSibling).toBeNull();
    expect(screen.queryByText(/Powered by Geoapify/)).not.toBeInTheDocument();
  });
});