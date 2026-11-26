"use client";

import type { AppearanceMode, SkinId } from "@roamlog/contracts";
import { QuickAppearanceMenu } from "@roamlog/ui";
import { useEffect, useRef, useState } from "react";

import {
  ADMIN_FALLBACK_APPEARANCE,
  adminAppearanceFromDocument,
  applyAdminAppearanceToDocument,
  fetchAdminAppearance,
  saveAdminAppearance,
  writeAdminAppearancePreviewCookie,
  type AdminAppearanceDraft,
} from "@/lib/appearance";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "外观保存失败，请稍后重试。";
}

export function QuickAppearanceControl() {
  const [current, setCurrent] = useState<AdminAppearanceDraft>(ADMIN_FALLBACK_APPEARANCE);
  const [canOverride, setCanOverride] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const loadedRef = useRef(false);
  const loadingRef = useRef(false);
  const userChangedRef = useRef(false);

  useEffect(() => {
    const initial = adminAppearanceFromDocument();
    setCurrent(initial);
    applyAdminAppearanceToDocument(initial);
  }, []);

  useEffect(() => {
    if (!open || loadedRef.current || loadingRef.current) return;
    loadingRef.current = true;
    void fetchAdminAppearance()
      .then((resolved) => {
        if (userChangedRef.current) return;
        const next: AdminAppearanceDraft = {
          mode: resolved.mode,
          skin: resolved.skin,
          fontPairing: resolved.fontPairing,
        };
        setCurrent(next);
        setCanOverride(resolved.canOverride);
        applyAdminAppearanceToDocument(next);
        writeAdminAppearancePreviewCookie(next);
        loadedRef.current = true;
      })
      .catch((cause) => {
        // A first-paint cookie already made the shell usable; keep it and show
        // the sync failure without blocking local switching.
        setError(errorText(cause));
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [open]);

  async function change(patch: { mode?: AppearanceMode; skin?: SkinId }): Promise<void> {
    if (!canOverride || saving) return;
    userChangedRef.current = true;
    const previous = current;
    const next: AdminAppearanceDraft = { ...current, ...patch };
    setCurrent(next);
    setError(null);
    applyAdminAppearanceToDocument(next);
    writeAdminAppearancePreviewCookie(next);
    setSaving(true);

    try {
      const saved = await saveAdminAppearance(patch);
      const resolved: AdminAppearanceDraft = {
        mode: saved.mode,
        skin: saved.skin,
        fontPairing: saved.fontPairing,
      };
      setCurrent(resolved);
      setCanOverride(saved.canOverride);
      applyAdminAppearanceToDocument(resolved);
      writeAdminAppearancePreviewCookie(resolved);
    } catch (cause) {
      setCurrent(previous);
      applyAdminAppearanceToDocument(previous);
      writeAdminAppearancePreviewCookie(previous);
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <QuickAppearanceMenu
      mode={current.mode}
      skin={current.skin}
      onModeChange={(mode) => void change({ mode })}
      onSkinChange={(skin) => void change({ skin })}
      moreHref="/admin/settings?tab=theme"
      disabled={!canOverride || saving}
      saving={saving}
      error={error ?? (canOverride ? null : "平台已锁定个人外观覆盖。")}
      onOpenChange={setOpen}
    />
  );
}
