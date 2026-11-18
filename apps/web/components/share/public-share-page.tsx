"use client";

import {
  PublicTripResponseSchema,
  type ProblemDetails,
  type PublicTripResponse,
} from "@roamlog/contracts";
import { Button, ErrorState, FormField, Input, Skeleton } from "@roamlog/ui";
import { Link2Off, LockKeyhole, RefreshCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { DATA_MODE } from "@/lib/data-mode";
import { getPublicTrip } from "@roamlog/api-client";

import type { DemoShareResolution } from "@/components/legacy-mock/share/demo-share";

import { ShareArticle } from "./share-article";

/**
 * Fixture boundary: demo share payloads come from a lazy-loaded legacy module,
 * so an api build never ships fixture data. The real share path below stays
 * statically imported.
 */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const loadDemoShare = isApiBuild
  ? undefined
  : () => import("@/components/legacy-mock/share/demo-share");

type ShareScreen =
  | { kind: "loading" }
  | { kind: "password"; invalid?: boolean }
  | { kind: "error"; title: string; description: string; retryable?: boolean }
  | { kind: "ready"; data: PublicTripResponse };

export function PublicSharePage({ token }: { token: string }) {
  const [screen, setScreen] = useState<ShareScreen>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setScreen({ kind: "loading" });

    if (DATA_MODE === "mock") {
      if (!loadDemoShare) return;
      loadDemoShare()
        .then(({ resolveDemoShare }) => {
          if (!active) return;
          setScreen(resolutionToScreen(resolveDemoShare(token)));
        })
        .catch(() => {
          if (!active) return;
          setScreen({
            kind: "error",
            title: "演示分享没有加载",
            description: "本地演示模块不可用，请刷新页面后重试。",
            retryable: true,
          });
        });
      return () => {
        active = false;
      };
    }

    getPublicTrip(token, undefined, { credentials: "include" })
      .then((response) => {
        if (!active) return;
        if (response.status === 200) {
          setScreen({
            kind: "ready",
            data: PublicTripResponseSchema.parse(response.data),
          });
          return;
        }
        const status: number = response.status;
        if (status === 401) {
          const problem = response.data as unknown as ProblemDetails;
          setScreen({
            kind: "password",
            invalid: problem.code === "SHARE_PASSWORD_INVALID",
          });
          return;
        }
        if (response.status === 404) {
          setScreen({
            kind: "error",
            title: "这个分享链接已失效",
            description: "链接可能已过期、被撤销，或从未存在。请联系分享者获取新的链接。",
          });
          return;
        }
        setScreen({
          kind: "error",
          title: "暂时无法读取分享",
          description: "分享服务没有正常响应，请稍后重试。",
          retryable: true,
        });
      })
      .catch(() => {
        if (!active) return;
        setScreen({
          kind: "error",
          title: "网络连接中断",
          description: "请检查网络后重试。分享内容不会保存在本机。",
          retryable: true,
        });
      });

    return () => {
      active = false;
    };
  }, [token, attempt]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim() || pending) return;

    if (DATA_MODE === "mock") {
      if (!loadDemoShare) return;
      const { resolveDemoShare } = await loadDemoShare();
      const resolution = resolveDemoShare(token, password);
      setScreen(resolutionToScreen(resolution));
      if (resolution.status === "invalid-password") setPassword("");
      return;
    }

    setPending(true);
    try {
      const response = await getPublicTrip(
        token,
        { password },
        { credentials: "include" },
      );
      if (response.status === 200) {
        setScreen({
          kind: "ready",
          data: PublicTripResponseSchema.parse(response.data),
        });
        return;
      }
      const status: number = response.status;
      if (status === 401) {
        setScreen({ kind: "password", invalid: true });
        setPassword("");
        return;
      }
      if (response.status === 404) {
        setScreen({
          kind: "error",
          title: "这个分享链接已失效",
          description: "链接可能已过期、被撤销，或从未存在。",
        });
        return;
      }
      setScreen({
        kind: "error",
        title: "暂时无法读取分享",
        description: "分享服务没有正常响应，请稍后重试。",
        retryable: true,
      });
    } catch {
      setScreen({
        kind: "error",
        title: "网络连接中断",
        description: "请检查网络后重试。",
        retryable: true,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      {screen.kind === "loading" ? <ShareLoading /> : null}

      {screen.kind === "password" ? (
        <ShareGate
          invalid={screen.invalid ?? false}
          password={password}
          pending={pending}
          onPassword={setPassword}
          onSubmit={submitPassword}
        />
      ) : null}

      {screen.kind === "error" ? (
        <div className="mx-auto flex min-h-dvh w-full max-w-[720px] items-center px-5 py-14">
          <div className="w-full">
            <ErrorState
              title={screen.title}
              description={screen.description}
              retryAction={
                screen.retryable ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    <RefreshCcw aria-hidden="true" />
                    重试
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                    <Link2Off aria-hidden="true" className="size-3.5" />
                    SHARE LINK NOT FOUND
                  </span>
                )
              }
            />
          </div>
        </div>
      ) : null}

      {screen.kind === "ready" ? <ShareArticle data={screen.data} /> : null}
    </div>
  );
}

function ShareLoading() {
  return (
    <div
      role="status"
      aria-label="正在读取分享"
      className="mx-auto w-full max-w-[880px] space-y-5 px-5 py-12 sm:px-8"
    >
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-56 rounded-card" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}

function ShareGate({
  invalid,
  password,
  pending,
  onPassword,
  onSubmit,
}: {
  invalid: boolean;
  password: string;
  pending: boolean;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] items-center px-5 py-14 sm:px-8">
      <div className="w-full rounded-card border border-hairline-strong bg-surface-1 p-6 sm:p-8">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
          Shared from Roamlog / Protected
        </p>
        <div className="mt-6 flex size-11 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2">
          <LockKeyhole aria-hidden="true" className="size-4 text-accent-orange" />
        </div>
        <h1 className="mt-5 font-serif text-3xl tracking-[-0.03em] text-ink">输入分享密码</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted">
          分享者设置了密码。密码只用于本次阅读，不会保存在浏览器中。
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <FormField
            label="分享密码"
            id="share-password"
            error={invalid ? "密码不正确，请重新输入。" : undefined}
          >
            <Input
              id="share-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
              aria-invalid={invalid}
              autoFocus
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={!password.trim() || pending}>
            {pending ? "验证中…" : "打开分享"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function resolutionToScreen(resolution: DemoShareResolution): ShareScreen {
  switch (resolution.status) {
    case "ready":
      return { kind: "ready", data: resolution.data };
    case "password":
      return { kind: "password" };
    case "invalid-password":
      return { kind: "password", invalid: true };
    case "expired":
      return {
        kind: "error",
        title: "这个分享链接已过期",
        description: "分享者设置了有效期。请请求一个新的链接，旧链接不会恢复访问。",
      };
    case "revoked":
      return {
        kind: "error",
        title: "这个分享链接已被撤销",
        description: "分享者收回了访问权限。如果你仍需要查看，请联系分享者重新创建链接。",
      };
    case "not-found":
      return {
        kind: "error",
        title: "找不到这个分享",
        description: "链接不完整、已过期或被撤销。请向分享者确认地址。",
      };
  }
}
