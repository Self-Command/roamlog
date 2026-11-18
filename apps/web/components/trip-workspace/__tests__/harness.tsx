import type {
  Trip,
  User,
  WorkspaceMemberWithUser,
  WorkspaceRole,
  WorkspaceWithRole,
} from "@roamlog/contracts";
import { TooltipProvider } from "@roamlog/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";

import { TEST_NOW, TEST_WORKSPACE_ID, createFakeAdapter } from "@/test/fake-data";

import { TripWorkspaceProvider } from "../workspace-context";

/** One captured `fetch` call — this is what mutation assertions run against. */
export interface FetchCall {
  method: string;
  url: string;
  body: unknown;
}

export type RouteResult = { status: number; body: unknown } | null;
export type RouteHandler = (call: FetchCall) => RouteResult;

function toResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Replaces `globalThis.fetch` with a router over the generated client's URLs.
 * The generated Orval client calls `fetch` directly, so this is the real seam:
 * assertions read the URL, method and JSON body that would hit the API.
 */
export function stubFetch(handlers: RouteHandler[]): FetchCall[] {
  const calls: FetchCall[] = [];

  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    const call: FetchCall = { method, url, body };
    calls.push(call);

    for (const handler of handlers) {
      const result = handler(call);
      if (result) return toResponse(result.status, result.body);
    }

    throw new Error(`stubFetch: 未处理的请求 ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fakeFetch);
  return calls;
}

/** Declarative route: exact path (or prefix, for query strings) or a RegExp. */
export function route(
  method: string,
  path: string | RegExp,
  body: unknown,
  status = 200,
): RouteHandler {
  return (call) => {
    if (method.toUpperCase() !== call.method) return null;
    const matches =
      typeof path === "string"
        ? call.url === path || call.url.startsWith(`${path}?`)
        : path.test(call.url);
    return matches ? { status, body } : null;
  };
}

export function problem(status: number, code: string, detail: string) {
  return { type: "about:blank", title: code, status, code, detail };
}

export function makeUser(overrides: Partial<User> & { id: string; name: string }): User {
  return {
    email: `${overrides.name}@roamlog.test`,
    emailVerified: true,
    image: null,
    platformRole: "user",
    status: "active",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    lastActiveAt: TEST_NOW,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    deletedAt: null,
    ...overrides,
  };
}

export function makeMember(
  user: User,
  role: WorkspaceRole = "editor",
): WorkspaceMemberWithUser {
  return {
    id: user.id,
    workspaceId: TEST_WORKSPACE_ID,
    userId: user.id,
    role,
    status: "active",
    joinedAt: TEST_NOW,
    invitedById: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    user,
  };
}

/** Fake `DataAdapter` that also answers the members query the workbench uses. */
export function adapterWith(options: {
  workspace: WorkspaceWithRole;
  members?: WorkspaceMemberWithUser[];
  trips?: Trip[];
}) {
  const base = createFakeAdapter({ workspace: options.workspace, trips: options.trips ?? [] });
  return {
    ...base,
    fetchMembers: vi.fn(async () => ({
      items: options.members ?? [],
      nextCursor: null,
      hasMore: false,
    })),
  };
}

export function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithClients(
  ui: ReactElement,
  options?: { client?: QueryClient } & Omit<RenderOptions, "wrapper">,
) {
  const { client, ...renderOptions } = options ?? {};
  const queryClient = client ?? createTestClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

/** Renders a single tab inside the workbench provider (trip + workspace resolved). */
export function renderTab(
  ui: ReactElement,
  context: { trip: Trip; workspace: WorkspaceWithRole; workspaceSlug?: string },
  options?: { client?: QueryClient },
) {
  return renderWithClients(
    <TripWorkspaceProvider
      trip={context.trip}
      workspace={context.workspace}
      workspaceSlug={context.workspaceSlug ?? context.workspace.slug}
    >
      {ui}
    </TripWorkspaceProvider>,
    options,
  );
}