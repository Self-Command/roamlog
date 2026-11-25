"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border border-accent-solid bg-accent-solid text-accent-contrast shadow-sm hover:bg-accent-solid/90",
        ghost:
          "border border-transparent bg-transparent text-body hover:bg-surface-1 hover:text-ink",
        outline:
          "border border-hairline-strong bg-surface-1 text-ink hover:border-ink/25 hover:bg-surface-2",
        subtle: "bg-surface-2 text-body hover:bg-surface-deep hover:text-ink",
        link: "h-auto rounded-none p-0 text-accent-blue underline-offset-4 hover:underline",
        danger: "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/15",
      },
      size: {
        sm: "h-11 px-3 text-xs md:h-8",
        md: "h-11 px-4 md:h-9",
        lg: "h-12 px-5 md:h-11",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const typeProps = asChild ? {} : { type };

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...typeProps}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
