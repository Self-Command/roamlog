"use client";

import type { ComponentProps } from "react";

import { cn } from "../cn";

/**
 * Minimal shadcn Card/Alert structure used by the AI Elements port.
 *
 * The upstream AI Elements package imports the shadcn primitives. Roamlog does
 * not vendor shadcn, so this file preserves the same element structure,
 * composable exports and accessibility roles while mapping the visual classes
 * onto Roamlog design tokens. This is the only presentation adaptation layer.
 */

export type CardProps = ComponentProps<"div">;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-hairline bg-surface-1 text-ink shadow-none",
        className,
      )}
      data-slot="card"
      {...props}
    />
  );
}

export type CardHeaderProps = ComponentProps<"div">;

export function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-4", className)}
      data-slot="card-header"
      {...props}
    />
  );
}

export type CardTitleProps = ComponentProps<"h3">;

export function CardTitle({ className, ...props }: CardTitleProps) {
  return (
    <h3
      className={cn("text-sm font-semibold leading-tight text-ink", className)}
      data-slot="card-title"
      {...props}
    />
  );
}

export type CardDescriptionProps = ComponentProps<"div">;

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return (
    <div
      className={cn("text-xs leading-5 text-muted", className)}
      data-slot="card-description"
      {...props}
    />
  );
}

export type CardActionProps = ComponentProps<"div">;

export function CardAction({ className, ...props }: CardActionProps) {
  return (
    <div
      className={cn("ml-auto shrink-0 self-start", className)}
      data-slot="card-action"
      {...props}
    />
  );
}

export type CardContentProps = ComponentProps<"div">;

export function CardContent({ className, ...props }: CardContentProps) {
  return <div className={cn("p-4 pt-0", className)} data-slot="card-content" {...props} />;
}

export type CardFooterProps = ComponentProps<"div">;

export function CardFooter({ className, ...props }: CardFooterProps) {
  return (
    <div
      className={cn("flex items-center p-4 pt-0", className)}
      data-slot="card-footer"
      {...props}
    />
  );
}

export type AlertProps = ComponentProps<"div">;

export function Alert({ className, ...props }: AlertProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-hairline bg-surface-1 p-3 text-sm text-body",
        className,
      )}
      data-slot="alert"
      role="alert"
      {...props}
    />
  );
}

export type AlertDescriptionProps = ComponentProps<"div">;

export function AlertDescription({ className, ...props }: AlertDescriptionProps) {
  return (
    <div
      className={cn("text-sm leading-6 text-body", className)}
      data-slot="alert-description"
      {...props}
    />
  );
}
