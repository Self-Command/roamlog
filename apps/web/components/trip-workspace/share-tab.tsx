"use client";

import { useCreateShareLink, useRevokeShareLink } from "@roamlog/api-client";
import type { CreateShareLinkRequest, ShareLink, ShareLinkCreated } from "@roamlog/contracts";
import { ShareLinkCreatedSchema } from "@roamlog/contracts";
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
import { Check, Copy, Link2, Plus, Share2, Trash2, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import { deniedReason } from "./capabilities";
import { ConfirmDialog } from "./dialogs";
import { shareLinkState, shortTimestamp } from "./format";
import { EmptyBlock, Panel, QueryPanel } from "./panel";
import { assertMutationOk, failureFrom, useShareLinks } from "./queries";
import { useTripWorkspace } from "./workspace-context";

type ExpiryChoice = "7" | "30" | "never";

const EXPIRY_LABELS: Record<ExpiryChoice, string> = {
  "7": "7 天后",
  "30": "30 天后",
  never: "永不过期",
};

function buildRequest(password: string, expiry: ExpiryChoice, showBudget: boolean, allowIndex: boolean): CreateShareLinkRequest {
  const days = expiry === "never" ? null : Number(expiry);
  return {
    ...(password.trim() ? { password } : {}),
    expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
    showBudget,
    allowIndex,
  };
}

function ShareLinkRow({
  link,
  canRevoke,
  revokeTitle,
  onRevoke,
}: {
  link: ShareLink;
  canRevoke: boolean;
  revokeTitle: string;
  onRevoke: () => void;
}) {
  const state = shareLinkState(link);
  return (
    <li className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.tone}>{state.label}</Badge>
          {link.hasPassword ? <Badge tone="neutral">密码</Badge> : null}
          {link.showBudget ? <Badge tone="neutral">含预算</Badge> : null}
          {link.allowIndex ? <Badge tone="yellow">允许收录</Badge> : <Badge tone="slate">禁止收录</Badge>}
        </div>
        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
          创建 {shortTimestamp(link.createdAt)} ·{" "}
          {link.expiresAt ? `过期 ${shortTimestamp(link.expiresAt)}` : "不过期"}
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-stone">
          访问 {link.accessCount} 次
          {link.lastAccessedAt ? ` · 最近 ${shortTimestamp(link.lastAccessedAt)}` : " · 还没有被访问"}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRevoke}
        disabled={!canRevoke || Boolean(link.revokedAt)}
        title={
          link.revokedAt
            ? "这个链接已经撤销"
            : canRevoke
              ? "撤销这个分享链接"
              : revokeTitle
        }
      >
        <Trash2 aria-hidden="true" />
        撤销
      </Button>
    </li>
  );
}

function ShareTabBody({ tripId }: { tripId: string }) {
  const { capabilities, mutate, pending, role } = useTripWorkspace();
  const links = useShareLinks(tripId);
  const createShareLink = useCreateShareLink();
  const revokeShareLink = useRevokeShareLink();

  const [formOpen, setFormOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>("30");
  const [showBudget, setShowBudget] = useState(false);
  const [allowIndex, setAllowIndex] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<ShareLinkCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ShareLink | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = password.trim();
    if (trimmed && trimmed.length < 8) {
      setFormError("密码至少需要 8 个字符。");
      return;
    }
    setFormError(null);

    const payload = buildRequest(password, expiry, showBudget, allowIndex);
    const result = await mutate({
      label: "这条分享链接",
      execute: async () => {
        const response = await createShareLink.mutateAsync({ tripId, data: payload });
        assertMutationOk(response, `/v1/trips/${tripId}/share-links`);
        const parsed = ShareLinkCreatedSchema.safeParse(response.data);
        if (!parsed.success) {
          throw failureFrom(200, null, "分享链接响应", "分享链接已创建，但返回的数据无法识别，请刷新页面确认。");
        }
        return parsed.data;
      },
      forbidden: "当前角色不能创建分享链接。Viewer 只能阅读和评论。",
      failure: "分享链接没有创建成功。",
    });

    if (result) {
      setCreated(result);
      setPassword("");
      setFormOpen(false);
    }
  }

  async function copyCreatedUrl() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    const revoked = await mutate({
      label: "这条分享链接",
      execute: async () => {
        const response = await revokeShareLink.mutateAsync({ shareLinkId: target.id });
        assertMutationOk(response, `/v1/share-links/${target.id}`);
        return response;
      },
      forbidden: "当前角色不能撤销分享链接。",
      failure: "分享链接没有撤销。",
    });
    if (revoked) setRevokeTarget(null);
  }

  return (
    <>
      {created ? (
        <section className="surface-card overflow-hidden" aria-label="新建的分享链接">
          <div className="border-b border-hairline bg-accent-orange/5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="orange">链接只显示一次</Badge>
              {created.hasPassword ? <Badge tone="neutral">密码</Badge> : null}
              {created.showBudget ? <Badge tone="neutral">含预算</Badge> : null}
            </div>
            <p className="mt-2 break-all font-mono text-[11px] leading-5 text-ink">{created.url}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="subtle" size="sm" onClick={() => void copyCreatedUrl()}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? "已复制" : "复制链接"}
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href={created.url} target="_blank" rel="noreferrer">
                  <Link2 aria-hidden="true" />
                  预览公开页
                </a>
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreated(null)}>
                关闭
              </Button>
            </div>
          </div>
          <p className="flex items-start gap-1.5 px-4 py-3 text-[10px] leading-5 text-muted">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-accent-yellow" />
            链接地址由系统生成。访问凭证只在创建时显示一次，撤销后立即失效。
          </p>
        </section>
      ) : null}

      <QueryPanel
        title="分享链接"
        meta={links.state === "ready" ? `${links.data.length} 条` : "读取中"}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setFormError(null);
              setFormOpen(true);
            }}
            disabled={!capabilities.createShareLink}
            title={capabilities.createShareLink ? undefined : deniedReason(role, "创建分享链接")}
          >
            <Plus aria-hidden="true" />
            创建链接
          </Button>
        }
        result={links}
        errorTitle="分享链接读取失败"
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyBlock
            icon={Share2}
            title="还没有分享链接"
            description="创建后会显示只读公开页的地址，可设置访问密码和过期时间。"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFormOpen(true)}
                disabled={!capabilities.createShareLink}
                title={capabilities.createShareLink ? undefined : deniedReason(role, "创建分享链接")}
              >
                <Plus aria-hidden="true" />
                创建第一个链接
              </Button>
            }
          />
        }
      >
        {(data) => (
          <ul className="divide-y divide-hairline">
            {data.map((link) => (
              <ShareLinkRow
                key={link.id}
                link={link}
                canRevoke={capabilities.revokeShareLink}
                revokeTitle={deniedReason(role, "撤销分享链接")}
                onRevoke={() => setRevokeTarget(link)}
              />
            ))}
          </ul>
        )}
      </QueryPanel>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>创建分享链接</DialogTitle>
              <DialogDescription>
                创建后，拿到链接的人可以阅读这趟旅行的公开内容；公开页只展示旅行、日志和照片，不展示评论、邮箱和内部备注。
              </DialogDescription>
            </DialogHeader>

            <FormField
              label="访问密码（可选）"
              hint="至少 8 个字符；留空表示拿到链接即可阅读。"
              error={formError}
              id="share-password"
            >
              <Input
                id="share-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>

            <div>
              <Label htmlFor="share-expiry">过期时间</Label>
              <Select
                id="share-expiry"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value as ExpiryChoice)}
              >
                {(Object.keys(EXPIRY_LABELS) as ExpiryChoice[]).map((choice) => (
                  <option key={choice} value={choice}>
                    {EXPIRY_LABELS[choice]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2 rounded-control border border-hairline bg-surface-2/40 p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="share-show-budget"
                  checked={showBudget}
                  onCheckedChange={(checked) => setShowBudget(checked === true)}
                />
                <div>
                  <Label htmlFor="share-show-budget" className="mb-0 normal-case tracking-normal">
                    显示预算摘要
                  </Label>
                  <p className="mt-0.5 text-[10px] leading-4 text-muted">
                    只显示总额与分类，不显示付款人、分账和备注。
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="share-allow-index"
                  checked={allowIndex}
                  onCheckedChange={(checked) => setAllowIndex(checked === true)}
                />
                <div>
                  <Label htmlFor="share-allow-index" className="mb-0 normal-case tracking-normal">
                    允许搜索引擎收录
                  </Label>
                  <p className="mt-0.5 text-[10px] leading-4 text-muted">
                    默认关闭。打开后公开页可能出现在搜索引擎结果中。
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "创建中…" : "创建分享链接"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="撤销这条分享链接？"
        description="撤销后旧地址立即失效，已打开的页面刷新后无法继续阅读。"
        confirmLabel="撤销链接"
        pending={pending}
        onConfirm={() => void confirmRevoke()}
      />
    </>
  );
}

export function ShareTab({ tripId }: { tripId: string }) {
  const { capabilities, role } = useTripWorkspace();

  if (!capabilities.readShareLinks) {
    return (
      <Panel title="分享链接">
        <EmptyBlock
          icon={Share2}
          title="当前角色不能查看分享链接"
          description={deniedReason(role, "查看分享链接")}
        />
      </Panel>
    );
  }

  return <ShareTabBody tripId={tripId} />;
}
