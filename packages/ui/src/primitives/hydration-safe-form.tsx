"use client";

import * as React from "react";

import { useHydrated } from "../lib/use-hydrated";
import { Button, type ButtonProps } from "./button";

export type HydrationSafeFormProps = Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  "method"
> & {
  method?: "post";
};

/**
 * Prevents a pre-hydration implicit submission from falling back to the
 * browser's default GET request, which can place credentials in the URL.
 */
export function HydrationSafeForm({ method = "post", ...props }: HydrationSafeFormProps) {
  return <form method={method} {...props} />;
}

export type HydrationSafeSubmitButtonProps = Omit<ButtonProps, "type" | "asChild">;

/**
 * The default submit button is disabled until React has hydrated the page.
 * This blocks both button clicks and implicit Enter submission before the
 * application's submit handler is available.
 */
export const HydrationSafeSubmitButton = React.forwardRef<
  HTMLButtonElement,
  HydrationSafeSubmitButtonProps
>(({ disabled, ...props }, ref) => {
  const hydrated = useHydrated();

  return <Button {...props} ref={ref} type="submit" disabled={!hydrated || disabled} />;
});

HydrationSafeSubmitButton.displayName = "HydrationSafeSubmitButton";
