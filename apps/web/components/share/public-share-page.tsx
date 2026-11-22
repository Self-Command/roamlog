"use client";

import { Button, ErrorState, FormField, Input, Skeleton } from "@roamlog/ui";
import { Link2Off, LockKeyhole, RefreshCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { getPublicTrip } from "@roamlog/api-client";

import {
  SHARE_NETWORK_ERROR,
  shareScreenFromResponse,
  type ShareScreen,
} from "./public-share-state";
import { ShareArticle } from "./share-article";

export function PublicSharePage({
  token,
  initialScreen,
}: {
  token: string;
  initialScreen?: ShareScreen;
}) {
  const [screen, setScreen] = useState<ShareScreen>(initialScreen ?? { kind: "loading" });
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // The server route already resolved the first screen. Keep it during
    // hydration; only a retry or a client-only render (tests/legacy callers)
    // starts a network request.
    if (initialScreen && attempt === 0) return;

    let active = true;
    setScreen({ kind: "loading" });

    getPublicTrip(token, undefined, { credentials: "include" })
      .then((response) => {
        if (!active) return;
        setScreen(shareScreenFromResponse(response.status, response.data));
      })
      .catch(() => {
        if (!active) return;
        setScreen(SHARE_NETWORK_ERROR);
      });

    return () => {
      active = false;
    };
  }, [attempt, initialScreen, token]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim() || pending) return;

    setPending(true);
    try {
      const response = await getPublicTrip(
        token,
        { password },
        { credentials: "include" },
      );
      const next = shareScreenFromResponse(response.status, response.data);
      setScreen(next);
      if (next.kind === "password" && next.invalid) setPassword("");
    } catch {
      setScreen(SHARE_NETWORK_ERROR);
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


