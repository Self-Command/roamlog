"use client";

import type { Trip } from "@roamlog/contracts";
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
} from "@roamlog/ui";
import { useEffect, useState } from "react";

/** Small destructive confirmation for one row (stop / photo / packing / share link). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "删除",
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" variant="danger" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Trip deletion. Deliberately two-step: open the dialog, then type the exact
 * trip title. The confirm button stays disabled until the text matches, so a
 * stray click cannot delete a trip.
 */
export function DeleteTripDialog({
  open,
  onOpenChange,
  trip,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trip: Trip;
  pending: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const matches = typed.trim() === trip.title.trim() && trip.title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除这趟旅行？</DialogTitle>
          <DialogDescription>
            删除后，这趟旅行及其日程节点、费用、行李和分享链接都会从界面上消失。
          </DialogDescription>
        </DialogHeader>
        <FormField
          label="输入旅行标题确认"
          hint={`请完整输入「${trip.title}」`}
          id="delete-trip-confirm"
        >
          <Input
            id="delete-trip-confirm"
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            placeholder={trip.title}
          />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!matches || pending}
            title={matches ? undefined : "需要先输入完整标题"}
            onClick={onConfirm}
          >
            {pending ? "删除中…" : "永久删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Trip duplication. The new title is optional — an empty field asks the server
 * for its own default instead of the client inventing one.
 */
export function DuplicateTripDialog({
  open,
  onOpenChange,
  trip,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trip: Trip;
  pending: boolean;
  onConfirm: (title: string | undefined) => void;
}) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!open) setTitle("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>复制这趟旅行</DialogTitle>
          <DialogDescription>
            会复制旅行信息、日程节点和行李清单。留空标题时会自动生成副本名称。
          </DialogDescription>
        </DialogHeader>
        <FormField label="副本标题（可选）" hint={`原旅行：${trip.title}`} id="duplicate-trip-title">
          <Input
            id="duplicate-trip-title"
            value={title}
            maxLength={160}
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() => onConfirm(title.trim() ? title.trim() : undefined)}
          >
            {pending ? "复制中…" : "创建副本"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
