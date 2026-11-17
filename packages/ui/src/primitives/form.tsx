"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted",
        className,
      )}
      {...props}
    />
  );
}

const controlClassName =
  "w-full rounded-control border border-hairline-strong bg-surface-1 text-sm text-ink outline-none transition-colors placeholder:text-stone hover:border-white/20 focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas aria-[invalid=true]:border-accent-red aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-accent-red/40 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("h-11 px-3 md:h-10", controlClassName, className)} {...props} />
));

Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn("min-h-28 resize-y px-3 py-2.5 leading-6", controlClassName, className)}
    {...props}
  />
));

Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <span className="relative block">
    <select
      ref={ref}
      className={cn("h-11 appearance-none px-3 pr-9 md:h-10", controlClassName, className)}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
    />
  </span>
));

Select.displayName = "Select";

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer relative size-6 shrink-0 rounded-[4px] border border-hairline-strong bg-surface-1 text-black outline-none transition-colors before:absolute before:-inset-2.5 before:content-[''] data-[state=checked]:border-ink data-[state=checked]:bg-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50 md:size-5",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <Check aria-hidden="true" className="size-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));

Checkbox.displayName = "Checkbox";

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-6 w-11 shrink-0 rounded-pill border border-hairline-strong bg-surface-2 outline-none transition-colors before:absolute before:-inset-2.5 before:content-[''] data-[state=checked]:border-ink data-[state=checked]:bg-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-body transition-transform duration-150 data-[state=checked]:translate-x-[20px] data-[state=checked]:bg-black" />
  </SwitchPrimitive.Root>
));

Switch.displayName = "Switch";

interface FieldControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

export interface FormFieldProps {
  id?: string;
  label: React.ReactNode;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactElement<FieldControlProps>;
}

export function FormField({
  id,
  label,
  error,
  hint,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const child = React.Children.only(children);
  const controlId = id ?? child.props.id ?? generatedId;
  const errorId = error ? `${controlId}-error` : undefined;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const childDescribedBy = child.props["aria-describedby"];
  const describedBy = [childDescribedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = React.cloneElement(child, {
    id: controlId,
    required: child.props.required ?? required,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : child.props["aria-invalid"],
  });

  return (
    <div className={cn("w-full", className)}>
      <Label htmlFor={controlId}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-accent-red">
            *
          </span>
        ) : null}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-5 text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs leading-5 text-accent-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
