import {
  AssistantRuntimeProvider,
  AuiConfig,
  unstable_Interactables,
  useLocalRuntime,
  type ChatModelAdapter,
  type Unstable_InteractablePersistenceAdapter,
} from "@assistant-ui/react";
import { render, type RenderResult } from "@testing-library/react";
import { useMemo, type ReactNode } from "react";

import { DraftScopeProvider } from "../draft-persistence";

export function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

export function DraftTestProvider({
  children,
  conversationId = "test-conversation",
  persistence,
}: {
  children: ReactNode;
  conversationId?: string;
  persistence?: Unstable_InteractablePersistenceAdapter;
}) {
  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run() {
        yield {
          content: [],
          status: { type: "complete", reason: "stop" },
        };
      },
    }),
    [],
  );
  const runtime = useLocalRuntime(adapter);
  const config = useMemo(
    () =>
      AuiConfig({
        unstable_interactables: unstable_Interactables(
          persistence ? { persistence } : {},
        ),
      }),
    [persistence],
  );

  return (
    <AssistantRuntimeProvider config={config} runtime={runtime}>
      <DraftScopeProvider conversationId={conversationId}>
        {children}
      </DraftScopeProvider>
    </AssistantRuntimeProvider>
  );
}

export function renderWithDraftRuntime(
  ui: ReactNode,
  options: {
    conversationId?: string;
    persistence?: Unstable_InteractablePersistenceAdapter;
  } = {},
): RenderResult {
  return render(
    <DraftTestProvider {...options}>{ui}</DraftTestProvider>,
  );
}
