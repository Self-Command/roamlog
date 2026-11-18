"use client";

import { Label } from "@roamlog/ui";
import * as React from "react";

export interface FieldControlProps {
  describedBy?: string;
  invalid: boolean;
}

export interface FormRowProps {
  id: string;
  label: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}

/**
 * Label + control + hint/error with the ids wired together.
 *
 * `@roamlog/ui`'s `FormField` clones a single child element, which does not fit
 * controls such as the date picker or the combobox that take an `invalid` prop
 * instead of raw `aria-invalid`. A render prop keeps the wiring explicit.
 */
export function FormRow({
  id,
  label,
  required = false,
  hint,
  error,
  className,
  children,
}: FormRowProps) {
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-accent-orange">
            *
          </span>
        ) : null}
      </Label>
      {children({ describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs leading-5 text-accent-red">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-5 text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FieldCounter({
  current,
  max,
  className,
}: {
  current: number;
  max: number;
  className?: string;
}) {
  return (
    <span className={`type-meta tabular-nums ${className ?? ""}`}>
      {current}/{max}
    </span>
  );
}
