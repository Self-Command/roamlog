"use client";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@roamlog/ui";
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import * as React from "react";

import {
  WEEKDAY_LABELS,
  addDays,
  addMonths,
  buildMonthWeeks,
  clampDateOnly,
  daysInMonth,
  formatDateOnlyLabel,
  formatMonthLabel,
  isDateOutsideRange,
  parseDateOnly,
  todayDateOnly,
  toDateOnly,
} from "./date-utils";

export interface DatePickerProps {
  id?: string;
  /** `YYYY-MM-DD`, or an empty string when nothing is selected yet. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Accessible name of the dialog grid; also used by tests. */
  gridLabel?: string;
}

interface VisibleMonth {
  year: number;
  month: number;
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function monthFromDate(value: string | undefined, fallback: string): VisibleMonth {
  const parts = parseDateOnly(value ?? "") ?? parseDateOnly(fallback);
  const now = new Date();
  return parts
    ? { year: parts.year, month: parts.month }
    : { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = "选择日期",
  disabled = false,
  invalid = false,
  describedBy,
  gridLabel = "选择日期",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const today = todayDateOnly();
  const initialFocus = React.useMemo(() => {
    const preferred = value || (min && min > today ? min : today);
    return clampDateOnly(preferred, min, max);
  }, [value, min, max, today]);
  const [focusedDay, setFocusedDay] = React.useState(initialFocus);
  const [visibleMonth, setVisibleMonth] = React.useState<VisibleMonth>(
    monthFromDate(value || initialFocus, today),
  );

  // Keep the grid aligned with the committed value whenever the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setFocusedDay(initialFocus);
    setVisibleMonth(monthFromDate(value || initialFocus, today));
    const frame = requestAnimationFrame(() => gridRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, initialFocus, value, today]);

  const weeks = React.useMemo(
    () => buildMonthWeeks(visibleMonth.year, visibleMonth.month),
    [visibleMonth],
  );

  const selectedDay = value && !isDateOutsideRange(value, min, max) ? value : "";

  function commit(day: string) {
    if (isDateOutsideRange(day, min, max)) return;
    onChange(day);
    setOpen(false);
  }

  function moveFocus(day: string) {
    const clamped = clampDateOnly(day, min, max);
    setFocusedDay(clamped);
    const parts = parseDateOnly(clamped);
    if (parts) setVisibleMonth({ year: parts.year, month: parts.month });
  }

  function shiftMonth(delta: number) {
    setVisibleMonth((current) => addMonths(current.year, current.month, delta));
    setFocusedDay((current) => {
      const parts = parseDateOnly(current);
      if (!parts) return current;
      const nextMonth = addMonths(visibleMonth.year, visibleMonth.month, delta);
      const day = Math.min(parts.day, daysInMonth(nextMonth.year, nextMonth.month));
      return toDateOnly({ year: nextMonth.year, month: nextMonth.month, day });
    });
  }

  function jumpToToday() {
    setFocusedDay(clampDateOnly(today, min, max));
    setVisibleMonth(monthFromDate(today, today));
    if (!isDateOutsideRange(today, min, max)) {
      commit(today);
    }
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(focusedDay);
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      shiftMonth(event.key === "PageUp" ? -1 : 1);
      return;
    }
    const delta =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -7
            : event.key === "ArrowDown"
              ? 7
              : null;
    if (delta === null) return;
    event.preventDefault();
    moveFocus(addDays(focusedDay, delta));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-label={selectedDay ? `${placeholder}：${formatDateOnlyLabel(selectedDay)}` : placeholder}
          className={cx(
            "w-full justify-between border-hairline-strong bg-surface-2 px-3 text-left font-normal normal-case tracking-normal",
            invalid && "border-accent-red/50",
            !selectedDay && "text-muted",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-stone" />
            <span className="truncate">
              {selectedDay ? formatDateOnlyLabel(selectedDay) : placeholder}
            </span>
          </span>
          <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        aria-label={gridLabel}
        className="w-[19rem] max-w-[calc(100vw-2rem)] p-3"
        onOpenAutoFocus={(event) => {
          // Keep focus on the trigger until the grid is mounted, then move it so
          // arrow keys reach the calendar without an extra Tab.
          event.preventDefault();
          gridRef.current?.focus();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="上个月"
            className="size-8 border-transparent bg-transparent px-0"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="type-meta text-body" aria-live="polite">
            {formatMonthLabel(visibleMonth.year, visibleMonth.month)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="下个月"
            className="size-8 border-transparent bg-transparent px-0"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1" role="presentation">
          {WEEKDAY_LABELS.map((label) => (
            <span
              key={label}
              role="columnheader"
              aria-label={`星期${label}`}
              className="py-1 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-stone"
            >
              {label}
            </span>
          ))}
        </div>

        <div
          ref={gridRef}
          role="grid"
          aria-label={gridLabel}
          tabIndex={0}
          aria-activedescendant={`date-picker-${gridLabel}-${focusedDay}`}
          onKeyDown={handleGridKeyDown}
          className="mt-1 grid grid-cols-7 gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} role="row" className="contents">
              {week.map((day, dayIndex) =>
                day === null ? (
                  <div
                    key={`empty-${weekIndex}-${dayIndex}`}
                    role="gridcell"
                    aria-hidden="true"
                    className="h-9"
                  />
                ) : (
                  <CalendarDay
                    key={day}
                    id={`date-picker-${gridLabel}-${day}`}
                    day={day}
                    selected={day === selectedDay}
                    focused={day === focusedDay}
                    today={day === today}
                    disabled={isDateOutsideRange(day, min, max)}
                    onSelect={() => commit(day)}
                  />
                ),
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-2">
          <p className="type-meta">{today}</p>
          <Button type="button" variant="subtle" size="sm" onClick={jumpToToday}>
            <RotateCcw aria-hidden="true" className="size-3" />
            今天
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CalendarDay({
  id,
  day,
  selected,
  focused,
  today,
  disabled,
  onSelect,
}: {
  id: string;
  day: string;
  selected: boolean;
  focused: boolean;
  today: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const dayNumber = parseDateOnly(day)?.day ?? day;
  return (
    <div
      id={id}
      role="gridcell"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      aria-current={today ? "date" : undefined}
      tabIndex={-1}
      onClick={disabled ? undefined : onSelect}
      className={cx(
        "flex h-9 items-center justify-center rounded-control font-mono text-xs tabular-nums transition-colors",
        disabled
          ? "cursor-not-allowed text-stone/40"
          : "cursor-pointer text-body hover:bg-surface-2 hover:text-ink",
        selected && "bg-ink font-medium text-black hover:bg-ink hover:text-black",
        !selected && focused && !disabled && "ring-1 ring-ink/60",
        !selected && today && "text-accent-blue",
      )}
    >
      {dayNumber}
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className="size-3 shrink-0 text-stone"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
