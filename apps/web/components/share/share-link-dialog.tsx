"use client";

import {
  ShareLinkCreatedSchema,
  type CreateShareLinkRequest,
  type ShareLinkCreated,
} from "@roamlog/contracts";
import { createShareLink } from "@roamlog/api-client";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  Select,
} from "@roamlog/ui";
import { Check, Copy, Link2, Share2, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import { DATA_MODE } from "@/lib/data-mode";

/** Fixture boundary: demo share registration is lazy-loaded and absent from api builds. */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const loadDemoShare = isApiBuild
  ? undefined
  : () => import("@/components/legacy-mock/share/demo-share");

const EXPIRY_OPTIONS = [
  { value: "7", label: "7 天后" },
  { value: "30", label: "30 天后" },
  { value: "never", label: "永不过期" },
] as const;

export function ShareLinkDialog({
  tripId,
  canShare = true,
}: {
  tripId: string;
  canShare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY_OPTIONS)[number]["value"]>("30");
  const [showBudget, setShowBudget] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ShareLinkCreated | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setPassword("");
    setExpiry("30");
    setShowBudget(false);
    setPending(false);
    setError(null);
    setCreated(null);
    setCopied(false);
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      reset();
    }
  }

  function buildRequest(): CreateShareLinkRequest {
    const days = expiry === "never" ? null : Number(expiry);
    return {
      password: password.trim() ? password : undefined,
      expiresAt: days
        ? new Date(Date.now() + days * 86_400_000).toISOString()
        : null,
      showBudget,
      allowIndex: false,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password && password.length < 8) {
      setError("密码至少需要 8 个字符。");
      return;
    }

    const input = buildRequest();
    setPending(true);
    try {
      if (DATA_MODE === "mock") {
        if (!loadDemoShare) {
          setError("演示分享模块不可用。");
          return;
        }
        const { registerMockShare } = await loadDemoShare();
        const token = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        registerMockShare(token, {
          password: input.password,
          showBudget: input.showBudget ?? false,
          expiresAt: input.expiresAt,
        });
        setCreated({
          id: token,
          workspaceId: tripId,
          tripId,
          createdById: tripId,
          expiresAt: input.expiresAt ?? null,
          revokedAt: null,
          hasPassword: Boolean(input.password),
          allowIndex: false,
          showBudget: Boolean(input.showBudget),
          lastAccessedAt: null,
          accessCount: 0,
          createdAt: new Date().toISOString(),
          token,
          url: `${window.location.origin}/share/${token}`,
        });
        return;
      }

      const response = await createShareLink(tripId, input, {
        credentials: "include",
      });
      if (response.status === 201) {
        setCreated(ShareLinkCreatedSchema.parse(response.data));
        return;
      }
      if (response.status === 403) {
        setError("当前角色不能创建分享链接。Viewer 只能阅读和评论。");
        return;
      }
      if (response.status === 400) {
        setError("分享设置无效，请检查密码和过期时间。");
        return;
      }
      setError("分享链接创建失败，请稍后重试。");
    } catch {
      setError("网络中断，分享链接没有创建。");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canShare}
        onClick={() => setOpen(true)}
        title={canShare ? undefined : "Viewer 不能创建分享链接"}
      >
        <Share2 aria-hidden="true" />
        分享
      </Button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{created ? "分享链接已创建" : "公开分享这趟旅行"}</DialogTitle>
            <DialogDescription>
              {created
                ? "令牌只会显示这一次。关闭后无法再次查看，只能重新创建链接。"
                : "公开页面只显示旅行、日志和照片，不显示评论、邮箱或内部备注。"}
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="space-y-4">
              <div className="rounded-control border border-accent-orange/25 bg-accent-orange/5 p-3">
                <div className="flex items-center gap-2">
                  <Badge tone="orange">TOKEN / ONE TIME</Badge>
                  {created.hasPassword ? <Badge tone="neutral">PASSWORD</Badge> : null}
                  {created.showBudget ? <Badge tone="neutral">BUDGET</Badge> : null}
                </div>
                <p className="mt-3 break-all font-mono text-[11px] leading-5 text-ink">
                  {created.url}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="subtle" size="sm" onClick={copy}>
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied ? "已复制" : "复制链接"}
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <a href={created.url} target="_blank" rel="noreferrer">
                      <Link2 aria-hidden="true" />
                      预览公开页
                    </a>
                  </Button>
                </div>
              </div>
              <p className="flex items-start gap-1.5 text-[10px] leading-5 text-muted">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-accent-yellow" />
                令牌相当于访问凭证。不要公开转发；撤销后旧链接会立即失效。
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <FormField
                label="访问密码（可选）"
                hint="至少 8 个字符。留空表示任何人拿到链接即可阅读。"
                error={error}
                id="share-create-password"
              >
                <Input
                  id="share-create-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="不设置密码"
                />
              </FormField>

              <div className="block">
                <Label htmlFor="share-expiry">过期时间</Label>
                <Select
                  id="share-expiry"
                  value={expiry}
                  onChange={(event) =>
                    setExpiry(event.target.value as (typeof EXPIRY_OPTIONS)[number]["value"])
                  }
                >
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-start gap-3 rounded-control border border-hairline bg-surface-2 p-3">
                <Checkbox
                  id="share-show-budget"
                  checked={showBudget}
                  onCheckedChange={(checked) => setShowBudget(checked === true)}
                />
                <div>
                  <Label htmlFor="share-show-budget" className="mb-0 normal-case tracking-normal">
                    显示预算摘要
                  </Label>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    只显示总额、分类和笔数；不显示付款人、成员分账或备注。
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => changeOpen(false)}>
                  取消
                </Button>
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? "创建中…" : "创建链接"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
