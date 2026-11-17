"use client";

import * as React from "react";

import { cn } from "../lib/cn";
import { Button, type ButtonProps } from "./button";

export interface IconButtonProps extends Omit<ButtonProps, "size"> {
  "aria-label": string;
  size?: "sm" | "md";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", variant = "ghost", ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size="md"
      className={cn(
        "aspect-square px-0",
        size === "sm" ? "size-11 md:size-8" : "size-11 md:size-9",
        className,
      )}
      {...props}
    />
  ),
);

IconButton.displayName = "IconButton";
