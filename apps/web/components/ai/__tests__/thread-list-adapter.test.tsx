import type { AiConversation } from "@roamlog/contracts";
import type { ExportedMessageRepositoryItem } from "@assistant-ui/react";
import { render, screen } from "@testing-library/react";
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("remote thread list adapter", () => {
  it("list() calls the workspace conversations endpoint and maps the page", async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ items: [makeConversation()], nextCursor: null }),
    );
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    const page = await adapter.list();

    expect(page).toEqual({
      threads: [
        {
          remoteId: CONVERSATION_ID,
          status: "regular",
          title: "京都一周",
          lastMessageAt: new Date(LAST_MESSAGE_AT),
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

  it("fetch() reads one conversation from the server", async () => {
    fetchMock.mockResolvedValue(makeResponse(makeConversation({ title: "归档会话" })));
    const adapter = createRemoteThreadListAdapter(WORKSPACE_ID);

    await expect(adapter.fetch(CONVERSATION_ID)).resolves.toEqual({
      remoteId: CONVERSATION_ID,
      status: "regular",
      title: "归档会话",
      lastMessageAt: new Date(LAST_MESSAGE_AT),
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
    expect(url).toBe(
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}/messages`,
    );
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

    await expect(adapter.list()).rejects.toThrow(
      "AI 会话服务暂时不可用，请稍后重试。",
    );

    render(<ConversationSyncStatus adapter={adapter} variant="sidebar" />);
    expect(screen.getByRole("alert")).toHaveTextContent("会话列表加载失败");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "AI 会话服务暂时不可用，请稍后重试。",
    );
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
    fetchMock.mockResolvedValue(
      makeResponse({ items: [makeConversation()], nextCursor: null }),
    );

    render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug="kyoto-crew" role="editor" />);

    expect(await screen.findByText("京都一周")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/v1/workspaces/${WORKSPACE_ID}/ai/conversations?limit=100`,
      expect.objectContaining({ method: "GET" }),
    );
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
