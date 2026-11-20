"use client";

import { Command as CommandPrimitive } from "cmdk";
import { Sparkles } from "lucide-react";
import * as React from "react";

/**
 * 移植来源: steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *   apps/web/components/tailwind/ui/command.tsx (134 行) — 整文件
 * 许可: Apache-2.0（修改过的移植副本）
 * 修改说明（Apache-2.0 §4(b)）:
 *   - 只保留 AI 面板实际用到的导出（`Command` / `CommandInput` / `CommandList` /
 *     `CommandEmpty` / `CommandGroup` / `CommandItem` / `CommandSeparator` /
 *     `CommandShortcut`）；上游的 `CommandDialog` 依赖它自己的 `dialog.tsx`，AI 面板
 *     不用，本文件不引入。
 *   - 设计 token：上游 shadcn 变量（`bg-popover`/`text-popover-foreground`/
 *     `text-muted-foreground`/`bg-accent`/`bg-border`/`purple-500`）换成本仓库 token
 *     （`bg-surface-1`/`text-ink`/`text-muted`/`bg-surface-2`/`bg-hairline`/`text-accent-blue`）。
 *   - `cn()`（clsx + tailwind-merge）在本仓库 `@roamlog/ui` 未导出，改用模板字符串拼接；
 *     本文件所有 className 都是静态的，不存在需要 tailwind-merge 去重的情况。
 *   - 图标：上游 `ui/icons/magic`（32 行 SVG）换成 `lucide-react` 的 `Sparkles`，
 *     与仓库既有 AI 入口同一个图标（规格 §6.1「纯装饰，等价替换」）。
 *   - 键盘导航/过滤/aria 全部由 `cmdk` 提供，未自写（规格 R3）。
 */

/** `cn`-equivalent for the static class lists in this file. */
function merge(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={merge("flex h-full w-full flex-col overflow-hidden rounded-control bg-surface-1 text-ink", className)}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b border-hairline px-4" cmdk-input-wrapper="">
    <Sparkles aria-hidden="true" className="mr-2 size-4 shrink-0 text-accent-blue" />
    <CommandPrimitive.Input
      ref={ref}
      className={merge(
        "flex h-11 w-full rounded-control bg-transparent py-3 text-sm outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={merge("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={merge(
      "overflow-hidden p-1 text-ink [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted",
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator ref={ref} className={merge("-mx-1 h-px bg-hairline", className)} {...props} />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={merge(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-surface-2 aria-selected:text-ink data-[disabled='true']:pointer-events-none data-[disabled='true']:opacity-50",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={merge("ml-auto text-xs tracking-widest text-muted", className)} {...props} />;
};
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};