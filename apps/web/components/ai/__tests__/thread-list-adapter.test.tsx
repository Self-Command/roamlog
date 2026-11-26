import type { AiConversation } from "@roamlog/contracts";
import type { ExportedMessageRepositoryItem } from "@assistant-ui/react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { ConversationSyncStatus, AiChat } from "../ai-chat";
import {
  createRemoteHistoryAdapter,
  createRemoteThreadListAdapter,
  threadHistoryKey,
  threadListKey,
} from "../thread-list-adapter";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const USER_ID = "018f0a00-0000-7000-8000-0000000000bb";
const CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000c1";
const CREATED_AT = "2026-11-20T08:00:00.000Z";
const LAST_MESSAGE_AT = "2026-11-20T09:00:00.000Z";

function makeConversation(overrides: Partial<AiConversation> = {}): AiConversation {
  return {
    id: CONVERSATION_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    title: "京都一周",
    titleSource: "placeholder",
    status: "regular",
    visibility: "private",
    shareUrl: null,
    lastMessageAt: LAST_MESSAGE_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function makeMessage(id: string, role: "user" | "assistant", content: string) {
  return {
    id,
    role,
    content,
    createdAt: CREATED_AT,
    clientId: id,
  };
}

/** Minimal Response stand-in: the generated client only reads status/text(). */
function makeResponse(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

function problem(status: number, code: string) {
  return {
    type: `https://roamlog.example/problems/${code.toLowerCase()}`,
    title: "AI conversation request failed",
    status,
    code,
  };
}

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  document.cookie = "sidebar_state=; path=/; max-age=0";
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("remote thread list adapter", () => {
  it("list() calls the workspace conversations endpoint and maps the page", async () => {
    fetchMock.mockResolvedValue(makeResponse({ items: [makeConversation()], nextCursor: null }));
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    const page = await adapter.list();

    expect(page).toEqual({
      threads: [
        {
          remoteId: CONVERSATION_ID,
          status: "regular",
          title: "京都一周",
          lastMessageAt: new Date(LAST_MESSAGE_AT),
          custom: { visibility: "private", shareUrl: null },
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/v1/workspaces/${WORKSPACE_ID}/ai/conversations?limit=100`);
    expect(init.method).toBe("GET");
  });

  it("initialize() creates a conversation and returns its id", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(makeConversation({ title: null, lastMessageAt: null }), 201),
    );
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await expect(adapter.initialize("local-thread-1")).resolves.toEqual({
      remoteId: CONVERSATION_ID,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/v1/workspaces/${WORKSPACE_ID}/ai/conversations`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("rename/archive/unarchive/delete each call their endpoint and body", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        return makeResponse(makeConversation({ title: "新标题" }));
      }
      if (url.endsWith("/archive")) {
        return makeResponse(makeConversation({ status: "archived" }));
      }
      if (url.endsWith("/unarchive")) {
        return makeResponse(makeConversation({ status: "regular" }));
      }
      if (init?.method === "DELETE") {
        return makeResponse({ message: "deleted" });
      }
      return makeResponse(makeConversation());
    });
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await adapter.rename(CONVERSATION_ID, "新标题");
    await adapter.archive(CONVERSATION_ID);
    await adapter.unarchive(CONVERSATION_ID);
    await adapter.delete(CONVERSATION_ID);

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual([
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}`,
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}/archive`,
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}/unarchive`,
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}`,
    ]);
    expect(calls[0]?.[1].method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ title: "新标题" });
    expect(calls[1]?.[1].method).toBe("POST");
    expect(calls[2]?.[1].method).toBe("POST");
    expect(calls[3]?.[1].method).toBe("DELETE");
  });

  it("deleteAll uses the single bulk-delete endpoint", async () => {
    fetchMock.mockResolvedValue(makeResponse({ deletedCount: 3 }));
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await adapter.deleteAll();

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(`/v1/workspaces/${WORKSPACE_ID}/ai/conversations`);
    expect(calls[0]?.[1].method).toBe("DELETE");
    expect(adapter.sync.getSnapshot()).toMatchObject({
      phase: "ready",
      threadCount: 0,
      listError: null,
    });
  });

  it("fetch() reads one conversation from the server", async () => {
    fetchMock.mockResolvedValue(makeResponse(makeConversation({ title: "归档会话" })));
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await expect(adapter.fetch(CONVERSATION_ID)).resolves.toEqual({
      remoteId: CONVERSATION_ID,
      status: "regular",
      title: "归档会话",
      lastMessageAt: new Date(LAST_MESSAGE_AT),
      custom: { visibility: "private", shareUrl: null },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}`);
    expect(init.method).toBe("GET");
  });

  it("history load() restores parent links and the server headId", async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        headId: "m3",
        messages: [
          { parentId: null, message: makeMessage("m1", "user", "你好") },
          { parentId: "m1", message: makeMessage("m2", "assistant", "你好，想去哪里？") },
          { parentId: "m2", message: makeMessage("m3", "user", "京都") },
        ],
      }),
    );
    const history = createRemoteHistoryAdapter(WORKSPACE_ID, () => CONVERSATION_ID);

    const repository = await history.load();

    expect(repository.headId).toBe("m3");
    expect(
      repository.messages.map((item) => ({ id: item.message.id, parentId: item.parentId })),
    ).toEqual([
      { id: "m1", parentId: null },
      { id: "m2", parentId: "m1" },
      { id: "m3", parentId: "m2" },
    ]);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}/messages`);
  });

  it("history load() ignores a persisted status on user messages", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        headId: "client-1",
        messages: [
          {
            parentId: null,
            message: {
              ...makeMessage("client-1", "user", "你好"),
              status: { type: "complete" },
            },
          },
        ],
      }),
    );

    const history = createRemoteHistoryAdapter(WORKSPACE_ID, () => CONVERSATION_ID);
    const repository = await history.load();

    expect(repository.messages[0]?.message).toMatchObject({
      id: "client-1",
      role: "user",
    });
    expect(repository.messages[0]?.message?.status).toBeUndefined();
  });

  it("history load() uses persisted client ids for deletion, not server UUIDs", async () => {
    const serverId1 = "01942f30-1200-7000-8000-0000000000d1";
    const serverId2 = "01942f30-1200-7000-8000-0000000000d2";
    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          headId: "client-2",
          messages: [
            {
              parentId: null,
              message: {
                id: serverId1,
                role: "user",
                content: "旧问题",
                createdAt: CREATED_AT,
                clientId: "client-1",
              },
            },
            {
              // The API persists the parent as the server UUID; the branch
              // repository must translate it to the child's client id.
              parentId: serverId1,
              message: {
                id: serverId2,
                role: "assistant",
                content: "旧回答",
                createdAt: LAST_MESSAGE_AT,
                clientId: "client-2",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeResponse({ message: "Messages deleted." }));

    const history = createRemoteHistoryAdapter(WORKSPACE_ID, () => CONVERSATION_ID);
    const repository = await history.load();

    expect(repository.messages.map((item) => item.message.id)).toEqual([
      "client-1",
      "client-2",
    ]);
    expect(repository.messages.map((item) => item.parentId)).toEqual([null, "client-1"]);

    expect(history.delete).toBeTypeOf("function");
    if (!history.delete) throw new Error("history.delete is required");
    await history.delete(repository.messages.slice(1));

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(deleteUrl).toBe(
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}/messages`,
    );
    expect(deleteInit.method).toBe("DELETE");
    expect(JSON.parse(String(deleteInit.body))).toEqual({ ids: ["client-2"] });
  });

  it("append() is idempotent: the same clientId sends one PUT with one body", async () => {
    fetchMock.mockResolvedValue(makeResponse(makeMessage("client-1", "user", "你好")));
    const history = createRemoteHistoryAdapter(WORKSPACE_ID, () => CONVERSATION_ID);
    const item = {
      parentId: null,
      message: {
        id: "client-1",
        role: "user",
        content: "你好",
        createdAt: new Date(CREATED_AT),
      },
    } as unknown as ExportedMessageRepositoryItem;

    await history.append(item);
    await history.append(item);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}/messages/client-1`,
    );
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      content: "你好",
      parentId: null,
    });
  });

  it("a failed append keeps the message in memory instead of throwing", async () => {
    fetchMock.mockResolvedValue(makeResponse(problem(500, "INTERNAL_ERROR"), 500));
    const history = createRemoteHistoryAdapter(WORKSPACE_ID, () => CONVERSATION_ID);
    const item = {
      parentId: null,
      message: {
        id: "client-2",
        role: "user",
        content: "还没保存",
        createdAt: new Date(CREATED_AT),
      },
    } as unknown as ExportedMessageRepositoryItem;

    await expect(history.append(item)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0);
  });

  it("shows the Chinese empty state after a successful empty list", async () => {
    fetchMock.mockResolvedValue(makeResponse({ items: [], nextCursor: null }));
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await adapter.list();
    render(<ConversationSyncStatus adapter={adapter} variant="sidebar" />);

    expect(screen.getByRole("status")).toHaveTextContent("还没有会话，发送第一条消息开始。");
  });

  it("a remote failure shows a Chinese error and never writes localStorage", async () => {
    fetchMock.mockResolvedValue(makeResponse(problem(500, "INTERNAL_ERROR"), 500));
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await expect(adapter.list()).rejects.toThrow("AI 会话服务暂时不可用，请稍后重试。");

    render(<ConversationSyncStatus adapter={adapter} variant="sidebar" />);
    expect(screen.getByRole("alert")).toHaveTextContent("会话列表加载失败");
    expect(screen.getByRole("alert")).toHaveTextContent("AI 会话服务暂时不可用，请稍后重试。");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it("generateTitle() asks the server to persist a model title", async () => {
    fetchMock.mockResolvedValue(makeResponse({ title: "京都一周" }));
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await adapter.generateTitle(CONVERSATION_ID, []);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}/title/generate`,
    );
    expect(init.method).toBe("POST");
  });

  it("AiChat renders the conversation list loaded from the server", async () => {
    fetchMock.mockResolvedValue(makeResponse({ items: [makeConversation()], nextCursor: null }));

    render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />);

    expect(await screen.findByText("京都一周")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations?limit=100`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("groups conversations by date, opens the delete confirmation, and updates the URL on selection", async () => {
    const now = new Date();
    const todayConversation = makeConversation({
      id: CONVERSATION_ID,
      title: "今天会话",
      lastMessageAt: new Date(now.getTime() - 60_000).toISOString(),
    });
    const yesterdayConversation = makeConversation({
      id: "018f0a00-0000-7000-8000-0000000000c2",
      title: "昨天会话",
      lastMessageAt: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/ai/conversations?") && (init?.method ?? "GET") === "GET") {
        return makeResponse({
          items: [todayConversation, yesterdayConversation],
          nextCursor: null,
        });
      }
      if (url.endsWith("/messages")) {
        return makeResponse({ headId: null, messages: [] });
      }
      return makeResponse(todayConversation);
    });
    const user = userEvent.setup();

    render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />);

    expect(await screen.findByRole("heading", { name: "今天" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "昨天" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "会话操作：今天会话" }));
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("“今天会话”及其消息将被永久删除");
    await user.click(screen.getByRole("button", { name: "取消" }));

    await user.click(screen.getByRole("button", { name: "今天会话" }));
    await waitFor(() => {
      expect(window.location.search).toBe(`?conversation=${CONVERSATION_ID}`);
    });
  });

  it("renames a conversation through the editor and reloads the server title", async () => {
    let title = "旧标题";
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/ai/conversations?") && (init?.method ?? "GET") === "GET") {
        return makeResponse({
          items: [makeConversation({ title, lastMessageAt: new Date().toISOString() })],
          nextCursor: null,
        });
      }
      if (url.endsWith(`/${CONVERSATION_ID}`) && init?.method === "PATCH") {
        title = JSON.parse(String(init.body)).title as string;
        return makeResponse(makeConversation({ title }));
      }
      if (url.endsWith("/messages")) {
        return makeResponse({ headId: null, messages: [] });
      }
      return makeResponse(makeConversation({ title }));
    });
    const user = userEvent.setup();

    render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />);

    await user.click(await screen.findByRole("button", { name: "会话操作：旧标题" }));
    await user.click(await screen.findByRole("menuitem", { name: "重命名" }));
    const input = screen.getByLabelText("会话标题");
    await user.clear(input);
    await user.type(input, "新标题");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("新标题")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("opens the delete-all confirmation before mutating anything", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ai/conversations?")) {
        return makeResponse({
          items: [makeConversation({ lastMessageAt: new Date().toISOString() })],
          nextCursor: null,
        });
      }
      return makeResponse({ headId: null, messages: [] });
    });
    const user = userEvent.setup();

    render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />);

    await user.click(await screen.findByRole("button", { name: "清空全部会话" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("所有 AI 会话和消息都会被永久删除");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("loads the next conversation page through the load-more action", async () => {
    const first = makeConversation({
      id: "018f0a00-0000-7000-8000-0000000000c1",
      title: "第一页",
      lastMessageAt: new Date().toISOString(),
    });
    const second = makeConversation({
      id: "018f0a00-0000-7000-8000-0000000000c2",
      title: "第二页",
      lastMessageAt: new Date(Date.now() - 60_000).toISOString(),
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cursor=cursor-2")) {
        return makeResponse({ items: [second], nextCursor: null });
      }
      if (url.includes("/ai/conversations?")) {
        return makeResponse({ items: [first], nextCursor: "cursor-2" });
      }
      return makeResponse({ headId: null, messages: [] });
    });
    const user = userEvent.setup();

    render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />);

    await user.click(await screen.findByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("第二页")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations?limit=100&cursor=cursor-2`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("restores the deep-linked conversation and its messages after a refresh", async () => {
    window.history.replaceState({}, "", `/?conversation=${CONVERSATION_ID}`);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ai/conversations?")) {
        return makeResponse({
          items: [
            makeConversation({
              title: "刷新后仍在",
              lastMessageAt: new Date().toISOString(),
            }),
          ],
          nextCursor: null,
        });
      }
      if (url.endsWith(`/${CONVERSATION_ID}/messages`)) {
        return makeResponse({
          headId: "m1",
          messages: [{ parentId: null, message: makeMessage("m1", "user", "刷新后的消息") }],
        });
      }
      return makeResponse(makeConversation());
    });

    render(
      <AiChat
        workspaceId={WORKSPACE_ID}
        workspaceSlug="kyoto-crew"
        role="editor"
        initialConversationId={CONVERSATION_ID}
      />,
    );

    expect(await screen.findByText("刷新后的消息")).toBeInTheDocument();
    expect(window.location.search).toBe(`?conversation=${CONVERSATION_ID}`);
  });

  it("deletes the active conversation, clears its URL, and returns to the new-thread state", async () => {
    window.history.replaceState({}, "", `/?conversation=${CONVERSATION_ID}`);
    let deleted = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/ai/conversations?") && (init?.method ?? "GET") === "GET") {
        return makeResponse({
          items: deleted
            ? []
            : [
                makeConversation({
                  title: "待删除会话",
                  lastMessageAt: new Date().toISOString(),
                }),
              ],
          nextCursor: null,
        });
      }
      if (url.endsWith(`/${CONVERSATION_ID}/messages`)) {
        return makeResponse({ headId: null, messages: [] });
      }
      if (url.endsWith(`/${CONVERSATION_ID}`) && init?.method === "DELETE") {
        deleted = true;
        return makeResponse({ message: "deleted" });
      }
      return makeResponse({ headId: null, messages: [] });
    });
    const user = userEvent.setup();

    render(
      <AiChat
        workspaceId={WORKSPACE_ID}
        workspaceSlug="kyoto-crew"
        role="editor"
        initialConversationId={CONVERSATION_ID}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "会话操作：待删除会话" }));
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(await screen.findByText("你的对话会出现在这里。")).toBeInTheDocument();
  });

  it("opens and closes the mobile conversation drawer", async () => {
    fetchMock.mockResolvedValue(makeResponse({ items: [], nextCursor: null }));
    const user = userEvent.setup();

    render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />);

    await user.click(screen.getByRole("button", { name: "打开会话列表" }));
    const closeButtons = screen.getAllByRole("button", { name: "关闭会话列表" });
    expect(closeButtons.length).toBeGreaterThan(0);
    await user.click(closeButtons[0]!);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "关闭会话列表" })).not.toBeInTheDocument();
    });
  });

  it("persists the desktop sidebar collapse state and supports Ctrl/Cmd+B", async () => {
    fetchMock.mockResolvedValue(makeResponse({ items: [], nextCursor: null }));
    const user = userEvent.setup();

    const first = render(
      <AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />,
    );

    expect(screen.getByRole("button", { name: "收起会话列表" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("button", { name: "展开会话列表" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.cookie).toContain("sidebar_state=false");

    first.unmount();
    render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />);
    expect(await screen.findByRole("button", { name: "展开会话列表" })).toBeInTheDocument();
  });

  it("clears legacy localStorage keys after the first successful remote load", async () => {
    window.localStorage.setItem(threadListKey(WORKSPACE_ID), JSON.stringify([{ remoteId: "old" }]));
    window.localStorage.setItem(
      threadHistoryKey(WORKSPACE_ID, "old-thread"),
      JSON.stringify([{ parentId: null, message: { id: "old-message" } }]),
    );
    window.localStorage.setItem("roamlog.unrelated", "keep-me");
    fetchMock.mockResolvedValue(makeResponse({ items: [], nextCursor: null }));
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await adapter.list();

    expect(window.localStorage.getItem(threadListKey(WORKSPACE_ID))).toBeNull();
    expect(window.localStorage.getItem(threadHistoryKey(WORKSPACE_ID, "old-thread"))).toBeNull();
    expect(window.localStorage.getItem("roamlog.unrelated")).toBe("keep-me");
  });
});
