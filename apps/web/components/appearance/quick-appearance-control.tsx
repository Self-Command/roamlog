"use client";

import {
  DEFAULT_FONT_PAIRING_ID,
  DEFAULT_SKIN_ID,
  normalizeFontPairingId,
  normalizeSkinId,
  type AppearanceMode,
  type FontPairingId,
  type SkinId,
} from "@roamlog/contracts";
import { QuickAppearanceMenu } from "@roamlog/ui";
import { useEffect, useState } from "react";

import { isApiError } from "@/lib/api";
import {
  applyAppearanceToDocument,
  writeAppearancePreviewCookie,
  type AppearanceDraft,
} from "@/lib/api/appearance";
import { useAppearanceQuery, useUpdateAppearanceMutation } from "@/lib/query";

type AppearancePatch = {
  mode?: AppearanceMode;
  skin?: SkinId;
};

function modeOf(value: string | undefined): AppearanceMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function fromDocument(): AppearanceDraft {
  if (typeof document === "undefined") {
    return {
      mode: "system",
      skin: DEFAULT_SKIN_ID,
      fontPairing: DEFAULT_FONT_PAIRING_ID,
    };
  }
  const root = document.documentElement;
  return {
    mode: modeOf(root.dataset.mode),
    skin: normalizeSkinId(root.dataset.skin),
    fontPairing: normalizeFontPairingId(root.dataset.font),
  };
}

function errorText(error: unknown): string {
  if (isApiError(error) && error.code === "APPEARANCE_OVERRIDE_DISABLED") {
    return "管理员已关闭个人外观覆盖。";
  }
  if (isApiError(error) && error.status === 401) {
    return "登录状态已过期，外观未同步到账号。";
  }
  return error instanceof Error ? error.message : "外观保存失败，请重试。";
}

export function QuickAppearanceControl({ workspaceSlug }: { workspaceSlug: string }) {
  const query = useAppearanceQuery();
  const update = useUpdateAppearanceMutation();
  const [local, setLocal] = useState<AppearanceDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolvedMode = query.data?.mode;
  const resolvedSkin = query.data?.skin;
  const resolvedFont = query.data?.fontPairing;

  useEffect(() => {
    if (!resolvedMode || !resolvedSkin || !resolvedFont) return;
    setLocal((previous) =>
      previous?.mode === resolvedMode &&
      previous.skin === resolvedSkin &&
      previous.fontPairing === resolvedFont
        ? previous
        : {
            mode: resolvedMode,
            skin: resolvedSkin,
            fontPairing: resolvedFont,
          },
    );
  }, [resolvedFont, resolvedMode, resolvedSkin]);

  useEffect(() => {
    if (query.data || local) return;
    setLocal(fromDocument());
  }, [local, query.data]);

  const current = local;
  const localOnly = isApiError(query.error) && query.error.status === 401;
  const canEdit = Boolean(current) && !update.isPending && (query.data?.canOverride ?? true);

  async function change(patch: AppearancePatch): Promise<void> {
    if (!current || !canEdit) return;
    const next: AppearanceDraft = { ...current, ...patch };
    setError(null);
    setLocal(next);
    applyAppearanceToDocument(next);
    writeAppearancePreviewCookie(next);

    if (localOnly) return;

    try {
      const saved = await update.mutateAsync(patch);
      setLocal({
        mode: saved.mode,
        skin: saved.skin,
        fontPairing: saved.fontPairing,
      });
    } catch (cause) {
      setLocal(current);
      applyAppearanceToDocument(current);
      writeAppearancePreviewCookie(current);
      setError(errorText(cause));
    }
  }

  function changeMode(mode: AppearanceMode): void {
    void change({ mode });
  }

  function changeSkin(skin: SkinId): void {
    void change({ skin });
  }

  const fallback = current ?? {
    mode: "system" as AppearanceMode,
    skin: DEFAULT_SKIN_ID as SkinId,
    fontPairing: DEFAULT_FONT_PAIRING_ID as FontPairingId,
  };

  return (
    <QuickAppearanceMenu
      mode={fallback.mode}
      skin={fallback.skin}
      onModeChange={changeMode}
      onSkinChange={changeSkin}
      moreHref={`/w/${workspaceSlug}/settings/appearance`}
      disabled={!canEdit}
      saving={update.isPending}
      error={error ?? (query.data?.canOverride === false ? "平台已锁定个人外观覆盖。" : null)}
    />
  );
}
