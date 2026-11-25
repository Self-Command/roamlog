"use client";

/**
 * Message-list scroll state ported from vercel/chatbot
 * `hooks/use-messages.tsx` + `hooks/use-scroll-to-bottom.tsx`
 * @ a8989b52 (Apache-2.0).
 *
 * Adaptation layer: the upstream hook types `status` as AI SDK's
 * `UseChatHelpers["status"]`; Roamlog uses assistant-ui, so the local union is
 * narrower and the caller derives it from `thread.isRunning`. The scroll
 * algorithm (100px bottom threshold, MutationObserver + ResizeObserver
 * auto-follow, reset) is unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

/**
 * Scrolls one interactive block to the top of the message viewport.
 *
 * Human-input forms and plan receipts are taller than a chat bubble. Following
 * their mutations to the bottom hides the title and the first question, so the
 * new block must establish its own reading position instead.
 */
export function scrollAnchorWithinContainer(
  container: HTMLDivElement,
  anchor: Element,
  topPadding = 12,
): void {
  const containerTop = container.getBoundingClientRect().top;
  const anchorTop = anchor.getBoundingClientRect().top;
  const nextTop = Math.max(
    0,
    container.scrollTop + anchorTop - containerTop - topPadding,
  );
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ behavior: "instant", top: nextTop });
  } else {
    container.scrollTop = nextTop;
  }
}

/**
 * The latest unanswered human form. `data-pending` is only emitted while the
 * tool part is in assistant-ui's `requires-action` state, so submitted receipts
 * and historical plans are deliberately excluded.
 */
export function latestPendingAnchor(root: ParentNode): Element | undefined {
  return Array.from(root.querySelectorAll('[data-pending="true"]')).at(-1);
}

export function useScrollToBottom({ autoScroll = true }: { autoScroll?: boolean } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const isUserScrollingRef = useRef(false);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  const checkIfAtBottom = useCallback(() => {
    if (!containerRef.current) {
      return true;
    }
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    return scrollTop + clientHeight >= scrollHeight - 100;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // jsdom has no layout engine and no scrollTo; the fallback keeps the same
    // behaviour in stores and tests without changing the browser path.
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ behavior, top: container.scrollHeight });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let scrollTimeout: ReturnType<typeof setTimeout>;

    const handleScroll = () => {
      isUserScrollingRef.current = true;
      clearTimeout(scrollTimeout);

      const atBottom = checkIfAtBottom();
      setIsAtBottom(atBottom);
      isAtBottomRef.current = atBottom;

      scrollTimeout = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 150);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [checkIfAtBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scrollIfNeeded = () => {
      if (autoScroll && isAtBottomRef.current && !isUserScrollingRef.current) {
        const settle = () => {
          if (typeof container.scrollTo === "function") {
            container.scrollTo({ behavior: "instant", top: container.scrollHeight });
          } else {
            container.scrollTop = container.scrollHeight;
          }
          setIsAtBottom(true);
          isAtBottomRef.current = true;
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(settle);
        } else {
          setTimeout(settle, 0);
        }
      }
    };

    const mutationObserver = new MutationObserver(scrollIfNeeded);
    mutationObserver.observe(container, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    const resizeObserver = new ResizeObserver(scrollIfNeeded);
    resizeObserver.observe(container);

    for (const child of container.children) {
      resizeObserver.observe(child);
    }

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [autoScroll]);

  function onViewportEnter() {
    setIsAtBottom(true);
    isAtBottomRef.current = true;
  }

  function onViewportLeave() {
    setIsAtBottom(false);
    isAtBottomRef.current = false;
  }

  const reset = useCallback(() => {
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    isUserScrollingRef.current = false;
  }, []);

  return {
    containerRef,
    endRef,
    isAtBottom,
    onViewportEnter,
    onViewportLeave,
    reset,
    scrollToBottom,
  };
}

export function useMessages({
  status,
  autoScroll = true,
}: {
  status: ChatStatus;
  autoScroll?: boolean;
}) {
  const {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    onViewportEnter,
    onViewportLeave,
    reset,
  } = useScrollToBottom({ autoScroll });

  const [hasSentMessage, setHasSentMessage] = useState(false);

  useEffect(() => {
    if (status === "submitted" || status === "streaming") {
      setHasSentMessage(true);
    }
  }, [status]);

  return {
    containerRef,
    endRef,
    hasSentMessage,
    isAtBottom,
    onViewportEnter,
    onViewportLeave,
    reset,
    scrollToBottom,
  };
}
