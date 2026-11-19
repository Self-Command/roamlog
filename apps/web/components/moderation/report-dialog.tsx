"use client";

import { useState, type FormEvent } from "react";
import { Flag, ShieldAlert } from "lucide-react";

import type {
  CreateReportRequest,
  ReportReason,
  ReportTargetType,
} from "@roamlog/contracts";
import { REPORT_ERROR_CODES } from "@roamlog/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Select,
  Textarea,
} from "@roamlog/ui";

import { isApiError } from "@/lib/api";

import { submitReport } from "./api";

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
  /** Human label used in the dialog copy (trip title, entry title, comment excerpt). */
  label: string;
}

export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: "spam", label: "垃圾广告或刷屏" },
  { value: "harassment", label: "骚扰、人身攻击" },
  { value: "private_info", label: "泄露个人隐私" },
  { value: "illegal", label: "违法或危险内容" },
  { value: "other", label: "其他问题" },
];

/**
 * Maps a failed report submission to copy a member can act on. The API codes
 * are the contract; unknown failures stay generic on purpose.
 */
export function reportErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "举报没有提交成功，请检查网络后重试。";
  }
  switch (error.code) {
    case REPORT_ERROR_CODES.duplicate:
      return "你已举报过这条内容";
    case REPORT_ERROR_CODES.targetNotFound:
      return "这条内容不存在，或你已无权查看。";
    case REPORT_ERROR_CODES.reasonInvalid:
      return "举报原因无效，请重新选择。";
    case "RATE_LIMITED":
      return "举报太频繁了，请一小时后再试。";
    default:
      if (error.status === 401) {
        return "登录已过期，请重新登录后再举报。";
      }
      return "举报没有提交成功，请稍后重试。";
  }
}

export function ReportDialog({
  open,
  onOpenChange,
  workspaceId,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  target: ReportTarget;
}) {
  const [reason, setReason] = useState<ReportReason>("spam");
  const [detail, setDetail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function reset() {
    setReason("spam");
    setDetail("");
    setError(null);
    setSubmitted(false);
    setPending(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    try {
      const input: Omit<CreateReportRequest, "detail"> & { detail?: string } = {
        targetType: target.type,
        targetId: target.id,
        reason,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      };
      await submitReport(workspaceId, input);
      setSubmitted(true);
    } catch (cause) {
      setError(reportErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          reset();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>举报这条内容</DialogTitle>
          <DialogDescription>
            举报会进入工作区管理员与平台审核队列。请只选择真实原因，管理员会看到内容快照。
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="space-y-4">
            <div
              role="status"
              className="flex items-start gap-2 rounded-control border border-accent-green/25 bg-accent-green/5 px-3 py-3 text-[12px] leading-5 text-accent-green"
            >
              <Flag aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              举报已提交。审核队列会看到这条内容和你的原因，处理结果不会公开你的身份。
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="rounded-control border border-hairline bg-surface-2/60 px-3 py-2.5">
              <p className="type-eyebrow">被举报内容</p>
              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-body">{target.label}</p>
            </div>

            {target.type === "comment" ? (
              <p className="flex items-start gap-2 text-[11px] leading-5 text-muted">
                <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                评论作者不会收到你的举报身份。
              </p>
            ) : null}

            <FormField label="举报原因" id="report-reason">
              <Select
                id="report-reason"
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.currentTarget.value as ReportReason)}
              >
                {REPORT_REASONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="补充说明（可选）"
              hint="最多 1000 字；不要粘贴他人隐私信息。"
              id="report-detail"
            >
              <Textarea
                id="report-detail"
                rows={3}
                maxLength={1000}
                value={detail}
                disabled={pending}
                placeholder="例如：同一段广告在不同日志下重复出现。"
                onChange={(event) => setDetail(event.currentTarget.value)}
              />
            </FormField>

            {error ? (
              <p role="alert" className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-[12px] text-accent-red">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "正在提交…" : "提交举报"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}