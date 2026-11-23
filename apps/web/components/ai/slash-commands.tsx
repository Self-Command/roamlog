"use client";

/**
 * Slash command menu ported from vercel/chatbot
 * `components/chat/slash-commands.tsx` @ a8989b52 (Apache-2.0).
 *
 * The upstream menu is a presentational list owned by the composer. Roamlog
 * keeps the same command set, icons, filtering and keyboard contract, while
 * exposing real actions through `SlashCommandHandlers` instead of the upstream
 * router/toast calls that do not exist in this app.
 */

import { Bomb, List, Palette, PenLine, PenSquare, Trash2, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "./cn";

export type SlashCommandAction =
  "new" | "clear" | "rename" | "model" | "theme" | "delete" | "purge";

export interface SlashCommandHandlers {
  new?: () => void | Promise<void>;
  clear?: () => void | Promise<void>;
  rename?: () => void | Promise<void>;
  model?: () => void | Promise<void>;
  theme?: () => void | Promise<void>;
  delete?: () => void | Promise<void>;
  purge?: () => void | Promise<void>;
}

export interface SlashCommand {
  name: string;
  description: string;
  icon: ReactNode;
  action: SlashCommandAction;
  shortcut?: string;
}

const iconClassName = "size-3.5";

export const slashCommands: readonly SlashCommand[] = [
  {
    action: "new",
    description: "新建会话",
    icon: <PenSquare className={iconClassName} />,
    name: "new",
  },
  {
    action: "clear",
    description: "清空当前会话消息",
    icon: <Trash2 className={iconClassName} />,
    name: "clear",
  },
  {
    action: "rename",
    description: "重命名当前会话",
    icon: <PenLine className={iconClassName} />,
    name: "rename",
  },
  {
    action: "model",
    description: "切换 AI 模型",
    icon: <List className={iconClassName} />,
    name: "model",
  },
  {
    action: "theme",
    description: "切换深色 / 浅色",
    icon: <Palette className={iconClassName} />,
    name: "theme",
  },
  {
    action: "delete",
    description: "删除当前会话",
    icon: <X className={iconClassName} />,
    name: "delete",
  },
  {
    action: "purge",
    description: "删除全部会话",
    icon: <Bomb className={iconClassName} />,
    name: "purge",
  },
];

export function filterSlashCommands(query: string): readonly SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  return slashCommands.filter((command) => command.name.startsWith(normalized));
}

export function slashCommandForText(value: string): SlashCommand | undefined {
  if (!value.startsWith("/")) return undefined;
  const query = value.slice(1).trim();
  if (!query || query.includes(" ")) return undefined;
  return slashCommands.find((command) => command.name === query);
}

export interface SlashCommandMenuProps {
  query: string;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose?: () => void;
}

export function SlashCommandMenu({
  query,
  selectedIndex,
  onSelect,
  onClose: _onClose,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const filtered = filterSlashCommands(query);

  useEffect(() => {
    const selected = menuRef.current?.querySelector<HTMLElement>("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, query]);

  if (filtered.length === 0) return null;

  return (
    <div
      className="absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-card border border-hairline-strong bg-surface-2/95 shadow-xl backdrop-blur"
      data-testid="slash-command-menu"
      ref={menuRef}
      role="listbox"
      aria-label="斜杠命令"
    >
      <div className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-stone">
        命令
      </div>
      <div className="max-h-64 overflow-y-auto pb-1">
        {filtered.map((command, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              aria-selected={selected}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors motion-reduce:transition-none",
                selected ? "bg-surface-1" : "hover:bg-surface-1/70",
              )}
              data-selected={selected ? "true" : "false"}
              data-testid={`slash-command-${command.name}`}
              key={command.name}
              onClick={() => onSelect(command)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span className="flex size-6 shrink-0 items-center justify-center text-stone">
                {command.icon}
              </span>
              <span className="font-mono text-[12px] text-ink">/{command.name}</span>
              <span className="text-[11px] text-muted">{command.description}</span>
              {command.shortcut ? (
                <span className="ml-auto font-mono text-[9px] text-stone">{command.shortcut}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
