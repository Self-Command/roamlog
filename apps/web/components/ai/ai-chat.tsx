"use client";

import type { WorkspaceRole } from "@roamlog/contracts";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { PLAN_TOOL_NAME, createAiChatModelAdapter } from "./chat-model-adapter";
import { WorkspaceChatProvider } from "./plan-card";
import { createLocalThreadListAdapter } from "./thread-list-adapter";
import { AiThreadList } from "./thread-list";
import { ChatThread } from "./thread";

/**
 * The single-column conversation shell for `/w/{slug}/ai`.
 *
 * Runtime composition follows the assistant-ui docs for a chat with a thread
 * list: `useRemoteThreadListRuntime({ adapter, runtimeHook })` wraps
 * `useLocalRuntime(chatModelAdapter, { unstable_humanToolNames })`, and
 * `AssistantRuntimeProvider` exposes it to the primitives.
 */

export interface AiChatProps {
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceRole;
}

export function AiChat({ workspaceId, workspaceSlug, role }: AiChatProps) {
  const canWrite = role === "owner" || role === "admin" || role === "editor";

  const chatModel = useMemo(
    () => createAiChatModelAdapter({ workspaceId, canWrite }),
    [workspaceId, canWrite],
  );
  const threadListAdapter = useMemo(
    () => createLocalThreadListAdapter(workspaceId),
    [workspaceId],
  );

  const runtimeHook = useCallback(
    () =>
      useLocalRuntime(chatModel, {
        unstable_humanToolNames: [PLAN_TOOL_NAME],
      }),
    [chatModel],
  );

  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook,
  });

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const context = useMemo(
    () => ({ workspaceSlug, canWrite }),
    [workspaceSlug, canWrite],
  );

  return (
    <WorkspaceChatProvider value={context}>
      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex h-[calc(100dvh-15rem)] min-h-[560px] overflow-hidden rounded-card border border-hairline-strong bg-surface-0">
          {collapsed ? null : (
            <aside
              aria-label="会话列表"
              className="hidden w-[248px] shrink-0 border-r border-hairline lg:block"
            >
              <AiThreadList />
            </aside>
          )}

          {drawerOpen ? (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button
                type="button"
                aria-label="关闭会话列表"
                className="absolute inset-0 bg-black/60"
                onClick={() => setDrawerOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 w-[80%] max-w-[320px] border-r border-hairline-strong shadow-xl">
                <AiThreadList onClose={() => setDrawerOpen(false)} />
              </div>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="hidden items-center gap-2 border-b border-hairline px-3 py-2 lg:flex">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={collapsed ? "展开会话列表" : "收起会话列表"}
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? (
                  <PanelLeftOpen aria-hidden="true" className="size-4" />
                ) : (
                  <PanelLeftClose aria-hidden="true" className="size-4" />
                )}
              </Button>
              <p className="type-meta truncate">AI 旅行助手 · 先计划，后写入</p>
            </div>

            <ChatThread onOpenSidebar={() => setDrawerOpen(true)} />
          </div>
        </div>
      </AssistantRuntimeProvider>
    </WorkspaceChatProvider>
  );
}
