"use client";

/**
 * Code block ported from vercel/chatbot `components/ai-elements/code-block.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0).
 *
 * Adaptation layer (the repository does not ship `shiki` or `@streamdown/*`,
 * and this task may not add dependencies):
 * - The public component surface (`CodeBlock`, `CodeBlockContainer`,
 *   `CodeBlockHeader`, `CodeBlockTitle`, `CodeBlockFilename`,
 *   `CodeBlockActions`, `CodeBlockContent`, `CodeBlockCopyButton`) is kept.
 * - Tokenisation/highlighting is replaced with a plain `<pre><code>` renderer.
 *   The surrounding container/header/copy-button structure is unchanged; only
 *   the shiki engine is missing, not the visual shell.
 */

import { Button } from "@roamlog/ui";
import { Check, Copy } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
} from "react";

import { cn } from "./cn";

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: string;
  showLineNumbers?: boolean;
};

interface CodeBlockContextType {
  code: string;
}

const CodeBlockContext = createContext<CodeBlockContextType>({ code: "" });

export const CodeBlockContainer = ({
  className,
  language,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
  <div
    className={cn(
      "group relative w-full min-w-0 overflow-hidden rounded-card border border-hairline bg-surface-0 text-body",
      className,
    )}
    data-language={language}
    style={{
      containIntrinsicSize: "auto 200px",
      contentVisibility: "auto",
      ...style,
    }}
    {...props}
  />
);

export const CodeBlockHeader = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-center justify-between border-b border-hairline bg-surface-2 px-3 py-2 text-xs text-muted",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export const CodeBlockTitle = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center gap-2", className)} {...props}>
    {children}
  </div>
);

export const CodeBlockFilename = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("font-mono", className)} {...props}>
    {children}
  </span>
);

export const CodeBlockActions = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("-my-1 -mr-1 flex items-center gap-2", className)} {...props}>
    {children}
  </div>
);

export function CodeBlockContent({
  code,
  language,
  showLineNumbers = false,
}: {
  code: string;
  language: string;
  showLineNumbers?: boolean;
}) {
  const lines = useMemo(() => code.split("\n"), [code]);

  return (
    <div className="relative min-w-0 overflow-auto">
      <pre className="m-0 min-w-0 p-3 font-mono text-xs leading-5">
        <code className="font-mono text-xs" data-language={language}>
          {lines.map((line, index) => (
            <span key={`line-${index}`} className="block min-w-0 whitespace-pre">
              {showLineNumbers ? (
                <span
                  aria-hidden="true"
                  className="mr-3 inline-block w-6 select-none text-right text-muted/60"
                >
                  {index + 1}
                </span>
              ) : null}
              {line.length === 0 ? "\n" : line}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const contextValue = useMemo(() => ({ code }), [code]);

  return (
    <CodeBlockContext.Provider value={contextValue}>
      <CodeBlockContainer className={className} language={language} {...props}>
        {children}
        <CodeBlockContent
          code={code}
          language={language}
          showLineNumbers={showLineNumbers}
        />
      </CodeBlockContainer>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);
  const { code } = useContext(CodeBlockContext);

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      if (!isCopied) {
        await navigator.clipboard.writeText(code);
        setIsCopied(true);
        onCopy?.();
        timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
      }
    } catch (error) {
      onError?.(error as Error);
    }
  }, [code, isCopied, onCopy, onError, timeout]);

  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const Icon = isCopied ? Check : Copy;

  return (
    <Button
      type="button"
      className={cn("size-8 shrink-0 px-0", className)}
      onClick={() => void copyToClipboard()}
      size="sm"
      variant="ghost"
      aria-label={isCopied ? "已复制" : "复制代码"}
      {...props}
    >
      {children ?? <Icon aria-hidden="true" className="size-3.5" />}
    </Button>
  );
};
