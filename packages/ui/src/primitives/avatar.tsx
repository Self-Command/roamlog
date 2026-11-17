import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";

import { cn } from "../lib/cn";
import { getInitials } from "../lib/initials";

export interface AvatarProps extends Omit<
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
  "children"
> {
  name: string;
  src?: string;
  size?: number;
  online?: boolean;
}

export function Avatar({
  className,
  name,
  src,
  size = 32,
  online = false,
  style,
  ...props
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      role="img"
      aria-label={online ? `${name}，在线` : name}
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <span className="flex size-full overflow-hidden rounded-pill border border-hairline-strong bg-surface-2 font-mono text-muted">
        <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />
        <AvatarPrimitive.Fallback
          delayMs={src ? 600 : 0}
          className="flex size-full items-center justify-center text-[10px]"
        >
          {getInitials(name)}
        </AvatarPrimitive.Fallback>
      </span>
      {online ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-pill border-2 border-canvas bg-accent-green"
        />
      ) : null}
    </AvatarPrimitive.Root>
  );
}

export interface AvatarGroupMember {
  id: string;
  name: string;
  src?: string;
  online?: boolean;
}

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  members: AvatarGroupMember[];
  max?: number;
  size?: number;
  label?: string;
}

export function AvatarGroup({
  members,
  max = 4,
  size = 28,
  label,
  className,
  ...props
}: AvatarGroupProps) {
  const visible = members.slice(0, max);
  const overflow = Math.max(0, members.length - visible.length);

  return (
    <div
      role="group"
      aria-label={label ?? `${members.length} 位参与者`}
      className={cn("flex items-center -space-x-2", className)}
      {...props}
    >
      {visible.map((member) => (
        <Avatar
          key={member.id}
          name={member.name}
          src={member.src}
          online={member.online}
          size={size}
          className="ring-2 ring-canvas"
        />
      ))}
      {overflow > 0 ? (
        <span
          aria-label={`另有 ${overflow} 位参与者`}
          className="inline-flex items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 font-mono text-[9px] text-muted ring-2 ring-canvas"
          style={{ width: size, height: size }}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
