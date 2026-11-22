"use client";

import { useEffect, useState } from "react";

import type {
  ProviderSecretFieldDescriptor,
  ProviderSecretRevealResponse,
  ProviderSecretState,
} from "@roamlog/contracts";
import { Button, FormField, Input } from "@roamlog/ui";

import { AdminMutationError } from "../../lib/admin-api-error";

const REVEAL_DURATION_MS = 10_000;

interface ProviderSecretFieldProps {
  field: ProviderSecretFieldDescriptor;
  saved: ProviderSecretState | undefined;
  value: string;
  error: string | undefined;
  canReveal: boolean;
  onChange: (value: string) => void;
  onReveal: () => Promise<ProviderSecretRevealResponse>;
}

interface RevealedSecret {
  value: string;
  expiresAt: number;
}

function revealErrorMessage(error: unknown): string {
  if (error instanceof AdminMutationError) {
    switch (error.failure.code) {
      case "ADMIN_2FA_REQUIRED":
        return "需要完成 TOTP 两步验证后才能显示明文。";
      case "ADMIN_ACCESS_DENIED":
        return "只有超级管理员可以显示服务商明文密钥。";
      case "SETTINGS_ENCRYPTION_UNAVAILABLE":
      case "PROVIDER_SECRETS_UNAVAILABLE":
        return "密钥服务不可用，请检查服务端加密配置后重试。";
      default:
        return (
          error.failure.detail?.trim() ||
          error.failure.title ||
          `显示失败（${error.failure.code}）。`
        );
    }
  }
  return error instanceof Error ? error.message : "显示失败，请重试。";
}

function hintFor(saved: ProviderSecretState | undefined): string {
  if (!saved?.hasValue) {
    return "尚未设置。";
  }
  return saved.last4
    ? `已保存 · ••••${saved.last4}。输入新值并保存即可替换。`
    : "已保存。输入新值并保存即可替换。";
}

export function ProviderSecretField({
  field,
  saved,
  value,
  error,
  canReveal,
  onChange,
  onReveal,
}: ProviderSecretFieldProps) {
  const [confirming, setConfirming] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    if (!revealed) {
      setSecondsLeft(0);
      return;
    }

    const tick = () => {
      const left = Math.max(0, Math.ceil((revealed.expiresAt - Date.now()) / 1_000));
      setSecondsLeft(left);
      if (left <= 0) {
        setRevealed(null);
      }
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [revealed]);

  function hideReveal() {
    setRevealed(null);
    setRevealError(null);
  }

  async function confirmReveal() {
    if (revealing) {
      return;
    }
    setRevealing(true);
    setRevealError(null);
    try {
      const response = await onReveal();
      const now = Date.now();
      const serverExpiry = response.expiresAt ? Date.parse(response.expiresAt) : Number.NaN;
      setRevealed({
        value: response.value,
        expiresAt: Number.isFinite(serverExpiry)
          ? Math.min(serverExpiry, now + REVEAL_DURATION_MS)
          : now + REVEAL_DURATION_MS,
      });
      setConfirming(false);
    } catch (cause) {
      setRevealError(revealErrorMessage(cause));
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="space-y-2">
      <FormField label={field.label} required={field.required} hint={hintFor(saved)} error={error}>
        <Input
          type={revealed ? "text" : "password"}
          autoComplete="off"
          readOnly={revealed !== null}
          value={revealed?.value ?? value}
          placeholder={saved?.hasValue ? "输入新值以替换" : "输入密钥"}
          onChange={(event) => {
            if (!revealed) {
              onChange(event.currentTarget.value);
            }
          }}
        />
      </FormField>

      {saved?.hasValue ? (
        <div className="flex flex-wrap items-center gap-2">
          {revealed ? (
            <>
              <span role="status" aria-live="polite" className="font-mono text-[10px] text-muted">
                明文将在 {secondsLeft} 秒后自动隐藏
              </span>
              <Button type="button" variant="outline" size="sm" onClick={hideReveal}>
                立即隐藏
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canReveal || revealing}
              title={canReveal ? "显示明文会写入审计" : "只有超级管理员可以显示明文"}
              onClick={() => {
                setConfirming(true);
                setRevealError(null);
              }}
            >
              {revealing ? "读取中…" : "显示明文"}
            </Button>
          )}
        </div>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-accent-yellow/30 bg-accent-yellow/5 px-3 py-3"
        >
          <p className="text-[12px] font-medium text-ink">确认显示这个密钥？</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            此操作需要已完成的 TOTP 会话，并会写入审计日志。明文只保留 10 秒。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={revealing}
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={revealing || !canReveal}
              onClick={() => void confirmReveal()}
            >
              {revealing ? "读取中…" : "确认显示"}
            </Button>
          </div>
        </div>
      ) : null}

      {revealError ? (
        <p role="alert" className="text-[11px] leading-5 text-accent-red">
          {revealError}
        </p>
      ) : null}
    </div>
  );
}
