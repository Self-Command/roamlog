"use client";

import { useEffect, useId, useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
} from "@roamlog/ui";

interface DestructiveActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  targetName: string;
  confirmationLabel: string;
  confirmActionLabel: string;
  onConfirm: () => void;
  roleOptions?: Array<{ value: string; label: string }>;
  roleValue?: string;
  onRoleValueChange?: (value: string) => void;
  roleLabel?: string;
}

export function DestructiveActionDialog({
  open,
  onOpenChange,
  title,
  description,
  targetName,
  confirmationLabel,
  confirmActionLabel,
  onConfirm,
  roleOptions,
  roleValue,
  onRoleValueChange,
  roleLabel = "新平台角色",
}: DestructiveActionDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const confirmationId = useId();

  useEffect(() => {
    if (!open) {
      setConfirmation("");
    }
  }, [open]);

  const confirmed = confirmation.trim() === targetName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <p className="type-eyebrow text-accent-red">危险操作 / 二次确认</p>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-control border border-hairline-strong bg-surface-2 p-3">
            <p className="type-eyebrow">操作目标</p>
            <p className="mt-1.5 text-sm text-ink">{targetName}</p>
          </div>

          {roleOptions && onRoleValueChange ? (
            <FormField id={`${confirmationId}-role`} label={roleLabel}>
              <Select
                value={roleValue}
                onChange={(event) => onRoleValueChange(event.currentTarget.value)}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          <FormField
            id={confirmationId}
            label={confirmationLabel}
            hint="该操作会记录模拟审计事件。当前没有连接真实 API。"
          >
            <Input
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              placeholder={targetName}
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={!confirmed}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmActionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
