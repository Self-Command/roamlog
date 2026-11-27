"use client";

import { Check, Copy, KeyRound, QrCode, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  FormField,
  HydrationSafeForm,
  HydrationSafeSubmitButton,
  Input,
  Separator,
} from "@roamlog/ui";

import {
  authBackupCodes,
  authErrorMessage,
  generatedAdminAuthTransport,
  type AdminAuthTransport,
} from "../../lib/admin-auth";
import { createQrMatrix, qrMatrixToSvgPath } from "../../lib/qr-code";

interface EnrollmentData {
  totpUri: string;
  backupCodes: string[];
}

export function TwoFactorEnrollmentPanel({
  transport,
  onComplete,
}: {
  transport?: AdminAuthTransport;
  onComplete?: () => void;
}) {
  const auth = transport ?? generatedAdminAuthTransport;
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function startEnrollment() {
    if (!password.trim()) {
      setMessage("请输入当前账户密码。");
      return;
    }
    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await auth.enableTotp(password);
      if (response.status >= 400) {
        setMessage(authErrorMessage(response));
        return;
      }
      const totpUri = response.data.totpURI ?? response.data.totpUri;
      if (typeof totpUri !== "string" || !totpUri) {
        setMessage("认证服务没有返回 totpURI。");
        return;
      }
      setEnrollment({
        totpUri,
        backupCodes: authBackupCodes(response),
      });
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法连接认证服务。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyEnrollment() {
    if (!/^\d{6}$/.test(code)) {
      setMessage("请输入 6 位数字验证码。");
      return;
    }
    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await auth.verifyTotp(code);
      if (response.status >= 400) {
        setMessage(authErrorMessage(response));
        return;
      }
      if (onComplete) {
        onComplete();
      } else {
        window.location.assign("/admin");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法连接认证服务。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-4">
      <header>
        <p className="type-eyebrow">安全 / 两步验证</p>
        <h1 className="mt-2 font-display text-[32px] font-semibold leading-10 tracking-[-0.025em] text-ink">
          为平台管理员启用两步验证
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted">
          为保证后台安全，请先完成两步验证。完成后才能继续管理操作。
        </p>
      </header>

      <Separator />

      {!enrollment ? (
        <section className="rounded-card border border-hairline-strong bg-surface-1 p-5">
          <div className="flex items-center gap-2">
            <KeyRound aria-hidden="true" className="size-4 text-muted" />
            <h2 className="text-[13px] font-medium text-ink">确认当前密码</h2>
          </div>
          <HydrationSafeForm
            className="mt-4 max-w-md space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void startEnrollment();
            }}
          >
            <FormField
              id="enrollment-password"
              label="当前密码"
              required
              hint="密码只用于本次绑定，不会被保存。"
            >
              <Input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </FormField>
            {message ? (
              <p role="alert" className="text-xs leading-5 text-accent-red">
                {message}
              </p>
            ) : null}
            <HydrationSafeSubmitButton variant="primary" disabled={isSubmitting}>
              <QrCode aria-hidden="true" />
              {isSubmitting ? "正在生成…" : "开始绑定验证器"}
            </HydrationSafeSubmitButton>
          </HydrationSafeForm>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <section className="rounded-card border border-hairline-strong bg-surface-1 p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="type-eyebrow">扫描验证器二维码</p>
              <Badge tone="green">安全绑定</Badge>
            </div>
            <TOTPQRCode uri={enrollment.totpUri} />
            <p className="mt-3 text-[10px] leading-5 text-muted">
              用身份验证器扫描二维码；验证码只在本次绑定中使用。
            </p>
            <a
              href={enrollment.totpUri}
              className="mt-2 block break-all font-mono text-[9px] leading-4 text-accent-blue underline-offset-4 hover:underline"
            >
              {enrollment.totpUri}
            </a>
          </section>

          <section className="space-y-4">
            <div className="rounded-card border border-hairline-strong bg-surface-1 p-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="type-eyebrow">备用码</p>
                  <h2 className="mt-1 text-[13px] font-medium text-ink">保存一次性备用码</h2>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(enrollment.backupCodes.join("\n"));
                    setCopied(true);
                  }}
                >
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-[11px] text-body">
                {enrollment.backupCodes.length > 0 ? (
                  enrollment.backupCodes.map((backupCode) => (
                    <li
                      key={backupCode}
                      className="rounded-control border border-hairline bg-surface-deep/60 px-2.5 py-2 tracking-[0.08em]"
                    >
                      {backupCode}
                    </li>
                  ))
                ) : (
                  <li className="col-span-2 text-muted">认证服务未返回备用码。</li>
                )}
              </ul>
            </div>

            <HydrationSafeForm
              className="rounded-card border border-hairline-strong bg-surface-1 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void verifyEnrollment();
              }}
            >
              <FormField
                id="enrollment-totp"
                label="验证器 6 位验证码"
                required
                hint="完成验证后，才能继续进入后台。"
              >
                <Input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  className="text-center font-mono text-lg tracking-[0.4em]"
                />
              </FormField>
              {message ? (
                <p role="alert" className="mt-3 text-xs leading-5 text-accent-red">
                  {message}
                </p>
              ) : null}
              <HydrationSafeSubmitButton
                variant="primary"
                className="mt-4 w-full"
                disabled={code.length !== 6 || isSubmitting}
              >
                <ShieldCheck aria-hidden="true" />
                {isSubmitting ? "正在验证…" : "完成两步验证"}
              </HydrationSafeSubmitButton>
            </HydrationSafeForm>
          </section>
        </div>
      )}
    </div>
  );
}

function TOTPQRCode({ uri }: { uri: string }) {
  const matrix = useMemo(() => createQrMatrix(uri), [uri]);
  const path = useMemo(() => qrMatrixToSvgPath(matrix), [matrix]);
  const size = (matrix.length + 8) * 5;

  return (
    // QR modules must stay pure black on white for scanner reliability.
    <div className="mt-4 overflow-hidden rounded-control border border-hairline bg-white p-3">
      <svg
        role="img"
        aria-label="验证器二维码"
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto h-auto w-full max-w-[220px]"
      >
        <rect width={size} height={size} fill="#ffffff" />
        <path d={path} fill="#000000" />
      </svg>
    </div>
  );
}
