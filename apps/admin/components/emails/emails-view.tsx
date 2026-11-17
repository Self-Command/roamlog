"use client";

import { useMemo, useState } from "react";
import { MailCheck, MailWarning, RefreshCw, Send, ShieldAlert } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type { EmailStatus } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  Select,
  Textarea,
} from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/fixtures";
import type { AdminDataMode } from "../../lib/admin-data-mode";
import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminMutationPort } from "../../lib/admin-data-source";
import { formatDateTime } from "../../lib/format";
import { recordMockAuditEvent } from "../../lib/mock-audit";
import { MOCK_ADMIN_EMAILS, type AdminEmailRecord } from "../../lib/ops-fixtures";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { AdminMetricCard } from "../dashboard/admin-metric-card";

interface EmailsViewProps {
  role: AdminConsoleRole;
  emails?: readonly AdminEmailRecord[];
  mode?: AdminDataMode;
  mutations?: AdminMutationPort;
}

const emailStatusLabels: Record<EmailStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Failed",
};

const emailStatusTones: Record<EmailStatus, "neutral" | "blue" | "green" | "red" | "yellow"> = {
  queued: "neutral",
  sent: "blue",
  delivered: "green",
  bounced: "yellow",
  complained: "red",
  failed: "red",
};

export function EmailsView({
  role,
  emails = MOCK_ADMIN_EMAILS,
  mode = "fixture",
  mutations,
}: EmailsViewProps) {
  const [records, setRecords] = useState<readonly AdminEmailRecord[]>(emails);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | EmailStatus>("all");
  const [template, setTemplate] = useState("all");
  const [statusMessage, setStatusMessage] = useState("");
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [testSubject, setTestSubject] = useState("Roamlog 后台测试邮件");
  const [testError, setTestError] = useState("");

  const canResend = canPlatform(role, "admin:emails:resend");
  const canSendTest = mode === "fixture" && (role === "admin" || role === "super_admin");
  const readOnly = role === "analyst";

  const templateOptions = useMemo(
    () => [...new Set(records.map((email) => email.template))].sort(),
    [records],
  );

  const filteredEmails = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return records.filter((email) => {
      const matchesQuery =
        !normalizedQuery ||
        `${email.to} ${email.subject} ${email.template}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery);
      return (
        matchesQuery &&
        (status === "all" || email.status === status) &&
        (template === "all" || email.template === template)
      );
    });
  }, [query, records, status, template]);

  const delivered = records.filter((email) => email.status === "delivered").length;
  const bounced = records.filter((email) => email.status === "bounced").length;
  const complained = records.filter((email) => email.status === "complained").length;
  const failed = records.filter((email) => email.status === "failed").length;

  async function resendEmail(record: AdminEmailRecord) {
    if (!canResend) {
      return;
    }
    if (mode === "api" && mutations) {
      try {
        await mutations.resendEmail(record.id);
      } catch (error) {
        setStatusMessage(
          error instanceof AdminMutationError
            ? `重发失败：${error.failure.code} · ${error.failure.detail}`
            : "重发失败，请检查 API 与权限后重试。",
        );
        return;
      }
    }
    const now = new Date().toISOString();
    setRecords((current) =>
      current.map((email) =>
        email.id === record.id
          ? { ...email, status: "queued", error: null, updatedAt: now }
          : email,
      ),
    );
    if (mode === "fixture") {
      recordMockAuditEvent({
        action: "admin.email.resend",
        targetType: "email_log",
        targetId: record.id,
        targetName: record.to,
        metadata: { mock: true, template: record.template, previousStatus: record.status },
      });
    }
    setStatusMessage(`已重新加入队列：${record.to}`);
  }

  function sendTestEmail() {
    const normalized = testRecipient.trim();
    if (!normalized.includes("@")) {
      setTestError("请输入有效的收件邮箱。");
      return;
    }
    const now = new Date().toISOString();
    const record: AdminEmailRecord = {
      id: `fixture-email-${Date.now()}`,
      to: normalized,
      template: "admin-test",
      subject: testSubject.trim() || "Roamlog 后台测试邮件",
      providerId: null,
      status: "queued",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    setRecords((current) => [record, ...current]);
    recordMockAuditEvent({
      action: "admin.email.test",
      targetType: "email_log",
      targetId: record.id,
      targetName: normalized,
      metadata: { mock: true, template: record.template },
    });
    setTestDialogOpen(false);
    setTestRecipient("");
    setTestSubject("Roamlog 后台测试邮件");
    setTestError("");
    setStatusMessage(`测试邮件已入队：${normalized}`);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="DELIVERY / EMAIL"
        title="邮件"
        description="检查 Resend 投递状态、退信与投诉，并重发失败邮件。"
        readOnly={readOnly}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={!canSendTest}
            title={
              canSendTest
                ? "发送测试邮件"
                : mode === "api"
                  ? "API 契约暂未提供测试邮件入口"
                  : "仅 Admin 及以上可发送测试邮件"
            }
            onClick={() => setTestDialogOpen(true)}
          >
            <Send aria-hidden="true" />
            测试邮件
          </Button>
        }
      />

      <section aria-label="邮件指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="已送达"
          value={String(delivered)}
          detail={mode === "api" ? "API delivery events" : "fixture delivery events"}
          tone="green"
          icon={MailCheck}
        />
        <AdminMetricCard
          label="退信"
          value={String(bounced)}
          detail="mailbox unavailable"
          tone={bounced > 0 ? "orange" : "neutral"}
          icon={MailWarning}
        />
        <AdminMetricCard
          label="投诉"
          value={String(complained)}
          detail="recipient marked as spam"
          tone={complained > 0 ? "red" : "neutral"}
          icon={ShieldAlert}
        />
        <AdminMetricCard
          label="失败"
          value={String(failed)}
          detail="provider timeout"
          tone={failed > 0 ? "red" : "neutral"}
          icon={MailWarning}
        />
      </section>

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索收件人 / 主题</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            value={query}
            placeholder="email 或模板"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">投递状态</span>
          <Select
            className="mt-1.5 h-9"
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as "all" | EmailStatus)}
          >
            <option value="all">全部状态</option>
            <option value="delivered">Delivered</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
            <option value="bounced">Bounced</option>
            <option value="complained">Complained</option>
            <option value="failed">Failed</option>
          </Select>
        </label>
        <label className="w-full md:w-48">
          <span className="type-eyebrow">模板</span>
          <Select
            className="mt-1.5 h-9"
            value={template}
            onChange={(event) => setTemplate(event.currentTarget.value)}
          >
            <option value="all">全部模板</option>
            {templateOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>
        <span className="flex h-9 items-center border-l border-hairline pl-3 font-mono text-[10px] text-muted max-md:hidden">
          {filteredEmails.length} / {records.length}
        </span>
      </AdminFilterBar>

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          Analyst 可读取投递日志与失败原因；重发与测试邮件保持可见但禁用。
        </div>
      ) : null}

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">投递日志</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              resend / {mode} webhook state
            </p>
          </div>
          <Badge tone={mode === "api" ? "green" : "neutral"}>{mode}</Badge>
        </div>

        {filteredEmails.length === 0 ? (
          <EmptyState
            icon={MailWarning}
            title="没有匹配邮件"
            description="调整收件人、模板或投递状态筛选后再试。"
            className="m-4"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
              <caption className="sr-only">邮件投递日志</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    收件人 / 主题
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    模板
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    状态
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    错误
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    时间
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredEmails.map((email) => (
                  <tr
                    key={email.id}
                    aria-label={`邮件 ${email.to}`}
                    className="h-12 transition-colors hover:bg-surface-2/60"
                  >
                    <td className="px-3 py-2">
                      <span className="block max-w-[280px] truncate text-[12px] text-ink">
                        {email.subject}
                      </span>
                      <span className="block max-w-[280px] truncate font-mono text-[9px] text-muted">
                        {email.to}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-body">{email.template}</td>
                    <td className="px-3 py-2">
                      <Badge tone={emailStatusTones[email.status]}>
                        {emailStatusLabels[email.status]}
                      </Badge>
                    </td>
                    <td className="max-w-[240px] px-3 py-2">
                      <span className="block truncate font-mono text-[9px] text-muted">
                        {email.error ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted">
                      {formatDateTime(email.updatedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`重发邮件至 ${email.to}`}
                          disabled={!canResend}
                          title={canResend ? "重新加入发送队列" : "当前角色不可重发邮件"}
                          onClick={() => resendEmail(email)}
                        >
                          <RefreshCw aria-hidden="true" />
                          重发
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow">RESEND / TEST</p>
            <DialogTitle>发送测试邮件</DialogTitle>
            <DialogDescription>
              {mode === "api"
                ? "当前 Admin API 契约未提供测试邮件入口，API 模式下该操作保持禁用。"
                : "测试邮件只写入本地 fixture 投递日志并记录模拟审计，不会调用真实 Resend API。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField id="test-email-recipient" label="收件邮箱" error={testError || undefined}>
              <Input
                type="email"
                autoComplete="off"
                value={testRecipient}
                placeholder="ops@example.invalid"
                onChange={(event) => {
                  setTestRecipient(event.currentTarget.value);
                  setTestError("");
                }}
              />
            </FormField>
            <FormField id="test-email-subject" label="主题">
              <Input
                value={testSubject}
                onChange={(event) => setTestSubject(event.currentTarget.value)}
              />
            </FormField>
            <FormField id="test-email-body" label="正文预览">
              <Textarea
                readOnly
                value={
                  "这是 Roamlog 后台的测试邮件。\n\n若你收到此邮件，说明本地 Resend 配置可被运营端触发。"
                }
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={sendTestEmail}>加入发送队列</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
