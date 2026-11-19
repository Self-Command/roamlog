"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@roamlog/ui";

import { failedAtOf, type ProbeCopy, type SettingsProbe } from "./probe-error-copy";

interface ProbeErrorBlockProps {
  probe: SettingsProbe;
  copy: ProbeCopy;
  serverDetail?: string | null;
  retrying?: boolean;
  onRetry: () => void;
}

function formatCheckMs(ms: number | undefined): string {
  return typeof ms === "number" && Number.isFinite(ms) ? `${Math.round(ms)}ms` : "—";
}

/**
 * Explains *which* settings save step failed.
 *
 * The main copy comes from the target+code mapping (`probe-error-copy.ts`);
 * the per-check list shows every step the probe ran, and the raw code/step
 * lives in a collapsed `<details>` for whoever debugs the deployment. The
 * error styling is hairline + `accent-red` on the true-black canvas, so the
 * white save button stays the only primary on the screen.
 */
export function ProbeErrorBlock({
  probe,
  copy,
  serverDetail,
  retrying = false,
  onRetry,
}: ProbeErrorBlockProps) {
  const failedAt = copy.failedAt ?? failedAtOf(probe.checks);

  return (
    <section
      role="alert"
      data-probe-block={probe.target}
      className="rounded-card border border-accent-red/30 bg-surface-1 px-4 py-3.5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-accent-red/25 bg-accent-red/10 text-accent-red">
          <AlertTriangle aria-hidden="true" className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="type-eyebrow text-accent-red">{copy.eyebrow}</p>
          <p
            data-probe-headline
            className="mt-1 text-[13px] font-medium leading-5 text-ink"
          >
            {copy.headline}
          </p>
          {copy.body ? (
            <p className="mt-1 text-[11px] leading-5 text-muted">{copy.body}</p>
          ) : null}

          {probe.checks.length > 0 ? (
            <ul aria-label="保存前探测步骤" className="mt-2.5 space-y-1">
              {probe.checks.map((check, index) => (
                <li
                  key={`${check.name}-${index}`}
                  data-probe-check-ok={check.ok ? "true" : "false"}
                  className="flex items-baseline gap-2 font-mono text-[10px] leading-4"
                >
                  <span
                    aria-hidden="true"
                    className={check.ok ? "text-accent-green" : "text-accent-red"}
                  >
                    {check.ok ? "✓" : "✗"}
                  </span>{" "}
                  <span className={check.ok ? "text-muted" : "font-medium text-ink"}>
                    {check.name}
                  </span>{" "}
                  <span className="tabular-nums text-stone">{formatCheckMs(check.ms)}</span>
                  <span className="sr-only">{check.ok ? "通过" : "失败"}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <details
            data-probe-technical
            className="mt-2.5 font-mono text-[9px] leading-5 text-stone"
          >
            <summary className="cursor-pointer select-none">技术详情</summary>
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
              <dt>code</dt>
              <dd className="break-all">{probe.code}</dd>
              <dt>target</dt>
              <dd>{probe.target}</dd>
              <dt>failedAt</dt>
              <dd>{failedAt ?? "—"}</dd>
              {serverDetail ? (
                <>
                  <dt>detail</dt>
                  <dd className="break-words">{serverDetail}</dd>
                </>
              ) : null}
            </dl>
          </details>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={retrying}
          onClick={onRetry}
        >
          <RotateCcw aria-hidden="true" />
          {retrying ? "重试中…" : "重试保存"}
        </Button>
      </div>
    </section>
  );
}