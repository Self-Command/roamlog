"use client";

import { RefreshCw, RotateCcw } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@roamlog/ui";

import type { AdminApiFailure } from "../../lib/admin-api-error";

interface ProviderConflictDialogProps {
  open: boolean;
  failure: AdminApiFailure | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadLatest: () => void;
  onRetry: () => void;
}

export function ProviderConflictDialog({
  open,
  failure,
  busy,
  onOpenChange,
  onLoadLatest,
  onRetry,
}: ProviderConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="provider-conflict-dialog">
        <DialogHeader>
          <DialogTitle>服务商顺序已变化</DialogTitle>
          <DialogDescription>
            {failure?.detail?.trim() || "另一位运营在你编辑期间调整了顺序。你的本地顺序仍被保留。"}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-control border border-accent-yellow/25 bg-accent-yellow/5 px-3 py-2 text-[11px] leading-5 text-body">
          可以载入最新顺序，或保留当前本地顺序并使用最新版本重试。
        </p>
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            继续编辑
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={onLoadLatest}>
            <RotateCcw aria-hidden="true" />
            载入最新顺序
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            {busy ? "正在重试…" : "保留我的顺序并重试"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
