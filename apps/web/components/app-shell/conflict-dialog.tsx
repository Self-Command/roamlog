"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@roamlog/ui";
import { RefreshCw, Save } from "lucide-react";

interface ConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityLabel: string;
  onReload: () => void;
  onOverwrite: () => void;
  pending?: boolean;
}

export function ConflictDialog({
  open,
  onOpenChange,
  entityLabel,
  onReload,
  onOverwrite,
  pending = false,
}: ConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>有人先保存了</DialogTitle>
          <DialogDescription>
            {entityLabel} 在你编辑期间被其他成员更新。重新加载会放弃本地改动；覆盖保存会把你的版本写入新版本并留下 revision。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onReload} disabled={pending}>
            <RefreshCw aria-hidden="true" />
            重新加载
          </Button>
          <Button type="button" variant="primary" onClick={onOverwrite} disabled={pending}>
            <Save aria-hidden="true" />
            覆盖保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
