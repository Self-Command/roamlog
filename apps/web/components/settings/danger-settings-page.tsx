"use client";

import {
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
  PageHeader,
  Select,
  Skeleton,
} from "@roamlog/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Download, FileArchive, Siren, Trash2, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import type {
  CreateExportRequest,
  ExportStatus,
  TransferOwnershipRequest,
} from "@roamlog/contracts";

import { isForbidden } from "@/lib/api";
import {
  createWorkspaceExport,
  deleteWorkspace,
  getWorkspaceExport,
  listWorkspaceExports,
  transferWorkspaceOwnership,
} from "@/lib/api/workspaces";
import { shortDate } from "@/lib/demo-format";
import {
  queryKeys,
  useMeQuery,
  useMembersQuery,
  useWorkspaceBySlug,
} from "@/lib/query";

/**
 * Workspace danger zone: export, ownership transfer, deletion.
 *
 * Contract sources:
 * - `packages/contracts/src/api/exports.ts:9-50` — create request + `downloadUrl`
 * - `packages/contracts/src/api/workspaces.ts:117-121` — `{ toUserId }`
 * - `packages/contracts/src/permissions.ts:339-340` — `workspace:delete` and
 *   `workspace:transfer-ownership` are owner-only
 */

const MEMBER_QUERY_PARAMS = { limit: 100 };

const EXPORT_STATUS_LABELS: Record<ExportStatus, string> = {
  queued: "排队中",
  processing: "生成中",
  ready: "可下载",
  failed: "生成失败",
  expired: "已过期",
};

const EXPORT_FORMATS = [
  { value: "zip", label: "ZIP 压缩包" },
  { value: "json", label: "JSON 数据" },
] as const;

const ROLES = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "只读成员",
} as const;

function exportTimestamp(value: string | null): string {
  if (!value) return "—";
  return shortDate(value.slice(0, 10));
}

export function DangerSettingsPage({ workspaceSlug }: { workspaceSlug: string }) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const meQuery = useMeQuery();
  const membersQuery = useMembersQuery(workspace?.id, MEMBER_QUERY_PARAMS);
  const queryClient = useQueryClient();

  const [exportFormat, setExportFormat] = useState<"zip" | "json">("zip");
  const [includeComments, setIncludeComments] = useState(false);
  const [includeExpenses, setIncludeExpenses] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [activeExportId, setActiveExportId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [transferTarget, setTransferTarget] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const historyKey = ["v1", "exports", workspace?.id ?? "none"] as const;

  const exportDetail = useQuery({
    queryKey: ["v1", "export", activeExportId],
    queryFn: ({ signal }) => getWorkspaceExport(activeExportId as string, signal),
    enabled: Boolean(activeExportId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 1_500 : false;
    },
  });

  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) =>
      listWorkspaceExports({ limit: 5, scope: "workspace", sort: "createdAt:desc" }, signal),
    enabled: Boolean(workspace),
  });

  const createExport = useMutation({
    mutationFn: (input: CreateExportRequest) => {
      if (!workspace) throw new Error("A workspace is required before exporting.");
      return createWorkspaceExport(workspace.id, input);
    },
    onSuccess: (record) => {
      setActiveExportId(record.id);
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });

  const transfer = useMutation({
    mutationFn: (input: TransferOwnershipRequest) => {
      if (!workspace) throw new Error("A workspace is required before transferring.");
      return transferWorkspaceOwnership(workspace.id, input);
    },
    onSuccess: () => {
      setTransferOpen(false);
      setNotice("所有权已转移。你现在是这个工作区的管理员。");
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace?.id) });
    },
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!workspace) throw new Error("A workspace is required before deleting.");
      return deleteWorkspace(workspace.id);
    },
    onSuccess: () => {
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      window.location.assign("/");
    },
  });

  if (workspacesQuery.isLoading || meQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-64 rounded-card" />
        <Skeleton className="h-52 rounded-card" />
      </div>
    );
  }

  if (!workspace || !meQuery.data) {
    return (
      <p className="text-sm text-muted">
        危险操作暂时不可用：当前账号不是该工作区的成员，或工作区地址已失效。
      </p>
    );
  }

  const isOwner = workspace.role === "owner";
  const roleLabel = ROLES[workspace.role];
  const candidates = (membersQuery.data?.items ?? []).filter(
    (member) =>
      member.status === "active" &&
      member.role !== "owner" &&
      member.userId !== meQuery.data?.id,
  );
  const transferHint = membersQuery.isLoading
    ? "正在加载可接收所有权的成员…"
    : membersQuery.isError
      ? "成员列表暂时无法加载，因此还不能选择接收人。"
      : candidates.length > 0
        ? "只能转给已经加入工作区的成员。"
        : "工作区里还没有其他可接收所有权的成员。先邀请对方加入，再回来转移。";

  const detail = exportDetail.data;
  const exporting =
    detail?.status === "queued" || detail?.status === "processing";
  const historyItems = (history.data?.items ?? []).filter(
    (item) => item.workspaceId === workspace.id,
  );

  function startExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setActiveExportId(null);
    createExport.mutate({
      scope: "workspace",
      format: exportFormat,
      includeComments,
      includeExpenses,
      includeMedia,
    });
  }

  async function download(exportId: string) {
    setError(null);
    setDownloadingId(exportId);
    try {
      const detailRecord = await getWorkspaceExport(exportId);
      if (!detailRecord.downloadUrl) {
        setError("导出文件还没有生成完成，请稍后刷新。");
        return;
      }
      const link = document.createElement("a");
      link.href = detailRecord.downloadUrl;
      link.rel = "noreferrer";
      link.target = "_blank";
      link.click();
    } catch {
      setError("下载链接获取失败，请稍后重试。");
    } finally {
      setDownloadingId(null);
    }
  }

  function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transferTarget) return;
    setError(null);
    transfer.mutate({ toUserId: transferTarget });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="工作区 / 危险操作"
        title="危险区"
        description="导出数据、转移所有权与删除工作区。每个操作都需要单独确认，执行前请读完说明。"
      />

      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs leading-5 text-accent-green"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs leading-5 text-accent-red"
        >
          {error}
        </p>
      ) : null}

      <section className="surface-card p-5" aria-label="导出数据">
        <div className="flex items-start gap-3 border-b border-hairline pb-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
            <FileArchive aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="type-eyebrow">导出</p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
              导出数据
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              把工作区的行程、日志、费用与照片打包保存。导出在后台生成，完成后可以随时下载；
              文件会在一段时间后过期，需要时重新导出即可。
            </p>
          </div>
        </div>

        <form className="mt-4 space-y-4" onSubmit={startExport}>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="导出格式">
              <Select
                value={exportFormat}
                onChange={(event) => setExportFormat(event.target.value as "zip" | "json")}
              >
                {EXPORT_FORMATS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="space-y-2">
              <span className="mb-1.5 block type-eyebrow">
                包含内容
              </span>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-body">
                  <Checkbox
                    checked={includeComments}
                    onCheckedChange={(checked) => setIncludeComments(checked === true)}
                  />
                  评论
                </label>
                <label className="flex items-center gap-2 text-sm text-body">
                  <Checkbox
                    checked={includeExpenses}
                    onCheckedChange={(checked) => setIncludeExpenses(checked === true)}
                  />
                  费用
                </label>
                <label className="flex items-center gap-2 text-sm text-body">
                  <Checkbox
                    checked={includeMedia}
                    onCheckedChange={(checked) => setIncludeMedia(checked === true)}
                  />
                  照片
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={createExport.isPending}>
              <Download aria-hidden="true" />
              {createExport.isPending ? "正在创建导出" : "开始导出"}
            </Button>
            {history.isFetching && !history.isLoading ? (
              <span className="text-[11px] text-stone">
                正在刷新记录
              </span>
            ) : null}
          </div>
        </form>

        {createExport.error ? (
          <p role="alert" className="mt-3 text-xs leading-5 text-accent-red">
            {isForbidden(createExport.error)
              ? "你的角色不能导出工作区数据。"
              : "导出没有创建成功，请稍后重试。"}
          </p>
        ) : null}

        {detail ? (
          <div
            role="group"
            aria-label="当前导出"
            className="mt-4 rounded-control border border-hairline-strong bg-surface-1 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="type-eyebrow">当前导出</p>
                <p className="mt-1.5 text-sm text-ink">
                  {EXPORT_STATUS_LABELS[detail.status]}
                  <span className="ml-2 font-mono text-[10px] tracking-[0.08em] text-stone">
                    {detail.format.toUpperCase()} · {exportTimestamp(detail.createdAt)}
                  </span>
                </p>
              </div>
              {detail.status === "ready" && detail.downloadUrl ? (
                <Button asChild variant="ghost">
                  <a href={detail.downloadUrl} target="_blank" rel="noreferrer">
                    <Download aria-hidden="true" />
                    下载导出文件
                  </a>
                </Button>
              ) : null}
            </div>

            {exporting ? (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-1.5 w-full motion-reduce:animate-none!" />
                <p className="text-[11px] text-muted">
                  正在后台生成，页面会在完成后自动更新，无需手动刷新。
                </p>
              </div>
            ) : null}

            {detail.status === "failed" ? (
              <p role="alert" className="mt-3 text-xs leading-5 text-accent-red">
                导出失败：{detail.error ?? "请重新导出。"}
              </p>
            ) : null}

            {detail.status === "expired" || (detail.status === "ready" && !detail.downloadUrl) ? (
              <p className="mt-3 text-xs leading-5 text-muted">
                下载链接已过期，重新导出即可获得新的文件。
              </p>
            ) : null}
          </div>
        ) : null}

        {historyItems.length > 0 ? (
          <div className="mt-4">
            <p className="type-eyebrow">最近的导出</p>
            <ul className="mt-2 divide-y divide-hairline">
              {historyItems.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">
                      {item.format.toUpperCase()} ·{" "}
                      <span className="text-muted">{EXPORT_STATUS_LABELS[item.status]}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-stone">
                      创建于 {exportTimestamp(item.createdAt)}
                      {item.expiresAt ? ` · 有效期至 ${exportTimestamp(item.expiresAt)}` : ""}
                    </p>
                  </div>
                  {item.status === "ready" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void download(item.id)}
                      disabled={downloadingId === item.id}
                    >
                      <Download aria-hidden="true" className="size-3.5" />
                      下载
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="surface-card p-5" aria-label="转移所有权">
        <div className="flex items-start gap-3 border-b border-hairline pb-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
            <ArrowRightLeft aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="type-eyebrow">所有权</p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
              转移所有权
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              把工作区交给另一位成员。转移完成后，对方成为所有者，你会变成管理员，仍然可以管理成员与内容，但不再拥有删除或继续转移的权限。
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <FormField
            label="接收人"
            hint={transferHint}
            error={
              membersQuery.isError
                ? "成员列表暂时无法加载，无法选择接收人。"
                : undefined
            }
          >
            <Select
              value={transferTarget}
              onChange={(event) => setTransferTarget(event.target.value)}
              disabled={!isOwner || candidates.length === 0}
            >
              <option value="">选择成员</option>
              {candidates.map((member) => (
                <option key={member.id} value={member.userId}>
                  {member.user.name} · {ROLES[member.role]}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setError(null);
                setTransferOpen(true);
              }}
              disabled={!isOwner}
            >
              <ArrowRightLeft aria-hidden="true" />
              转移所有权
            </Button>
            {!isOwner ? (
              <p className="text-[11px] leading-5 text-muted">
                只有所有者可以转移所有权。你当前的角色是{roleLabel}。
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="surface-card p-5" aria-label="删除工作区">
        <div className="flex items-start gap-3 border-b border-hairline pb-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-accent-red/30 bg-accent-red/10 text-accent-red">
            <Siren aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="type-eyebrow">删除</p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
              删除工作区
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              删除后，工作区会从所有成员的列表中移除，其中的行程、日志、照片与费用都不再可访问。
              这个操作无法在应用内撤销，只能由平台管理员协助恢复。
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setError(null);
              setConfirmName("");
              setDeleteOpen(true);
            }}
            disabled={!isOwner}
          >
            <Trash2 aria-hidden="true" />
            删除此工作区
          </Button>
          {!isOwner ? (
            <p className="text-[11px] leading-5 text-muted">
              只有所有者可以删除工作区。你当前的角色是{roleLabel}。
            </p>
          ) : null}
        </div>
      </section>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <form onSubmit={submitTransfer} className="space-y-4">
            <DialogHeader>
              <DialogTitle>确认转移所有权</DialogTitle>
              <DialogDescription>
                转移后，你会立即变成管理员，并且不能再删除或转移这个工作区。请确认接收人是你信任的成员。
              </DialogDescription>
            </DialogHeader>

            <FormField
              label="接收人"
              hint={candidates.length === 0 ? "没有符合条件的成员，无法继续。" : undefined}
            >
              <Select
                value={transferTarget}
                onChange={(event) => setTransferTarget(event.target.value)}
              >
                <option value="">选择成员</option>
                {candidates.map((member) => (
                  <option key={member.id} value={member.userId}>
                    {member.user.name} · {ROLES[member.role]}
                  </option>
                ))}
              </Select>
            </FormField>

            <p className="flex items-start gap-2 rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-[11px] leading-5 text-accent-red">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              这是不可逆的权限变更：你将失去所有者专属的删除与转移权限。
            </p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTransferOpen(false)}>
                取消
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={!transferTarget || transfer.isPending || candidates.length === 0}
              >
                确认转移
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>删除工作区</DialogTitle>
              <DialogDescription>
                工作区「{workspace.name}」会被删除，所有成员都会失去访问权限。这个操作无法在应用内撤销。
              </DialogDescription>
            </DialogHeader>

            <FormField
              label="输入工作区名称以确认"
              hint={`请输入「${workspace.name}」的完整名称，确认按钮才会启用。`}
            >
              <Input
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder={workspace.name}
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>

            <p className="flex items-start gap-2 rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-[11px] leading-5 text-accent-red">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              删除后数据不再可访问。除平台管理员协助恢复外，没有其他找回方式。
            </p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => remove.mutate()}
                disabled={
                  confirmName.trim() !== workspace.name || remove.isPending
                }
              >
                {remove.isPending ? "正在删除" : "确认删除"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
