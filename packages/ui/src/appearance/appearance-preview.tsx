import {
  FONT_PAIRING_CATALOG,
  SKIN_CATALOG,
  type AppearanceMode,
  type FontPairingId,
  type SkinId,
} from "@roamlog/contracts";
import type { CSSProperties } from "react";

export type AppearanceSurface = "web" | "share" | "journal" | "card" | "error" | "empty";

export interface AppearancePreviewProps {
  mode: AppearanceMode;
  skin: SkinId;
  fontPairing: FontPairingId;
  surface?: AppearanceSurface;
}

function panelStyle(
  palette: { canvas: string; ink: string; accent: string },
  font: (typeof FONT_PAIRING_CATALOG)[number],
): CSSProperties {
  return {
    backgroundColor: palette.canvas,
    color: palette.ink,
    fontFamily: font.bodyStack,
    "--preview-accent": palette.accent,
  } as CSSProperties;
}

function copyForSurface(surface: AppearanceSurface): {
  eyebrow: string;
  title: string;
  body: string;
  meta: string;
  action: string;
} {
  switch (surface) {
    case "share":
      return {
        eyebrow: "2026.11 / Public share",
        title: "京都，雨后散步",
        body: "从鸭川到东山，把一段安静的旅行分享给同行的人。",
        meta: "公开分享 · 9 张照片",
        action: "继续阅读",
      };
    case "journal":
      return {
        eyebrow: "2026.11 / Journal",
        title: "在雨停之前",
        body: "旅行的意义不是抵达，而是把一段普通的日子保存成可以再次进入的房间。",
        meta: "日志 · 1,842 字",
        action: "打开日志",
      };
    case "card":
      return {
        eyebrow: "2026.11 / Trip card",
        title: "周末的濑户内海",
        body: "从直岛港口到旧城巷口，把路线、照片和同行者的笑声留在这里。",
        meta: "3 天 · 4 站",
        action: "查看旅程",
      };
    case "error":
      return {
        eyebrow: "Share unavailable",
        title: "无法打开这次旅行",
        body: "分享链接已失效，或你暂时没有访问权限。请联系分享者获取新的链接。",
        meta: "错误状态 · 可恢复",
        action: "返回首页",
      };
    case "empty":
      return {
        eyebrow: "New archive",
        title: "还没有旅行记录",
        body: "创建第一段旅程，把路线、照片和那些不想忘记的细节一起保存下来。",
        meta: "空状态 · 从这里开始",
        action: "创建旅程",
      };
    case "web":
    default:
      return {
        eyebrow: "2026.11 / Naoshima",
        title: "在雨停之前，去看海",
        body: "从直岛港口到旧城巷口，把路线、照片和同行者的笑声一起留在这本旅行档案里。",
        meta: "12 张照片 · 4 站",
        action: "继续阅读",
      };
  }
}

function PreviewPanel({
  mode,
  skin,
  fontPairing,
  surface,
}: Required<AppearancePreviewProps> & { mode: "light" | "dark" }) {
  const skinEntry = SKIN_CATALOG.find((entry) => entry.id === skin) ?? SKIN_CATALOG[0];
  const fontEntry =
    FONT_PAIRING_CATALOG.find((entry) => entry.id === fontPairing) ?? FONT_PAIRING_CATALOG[0];
  const palette = mode === "light" ? skinEntry.lightPreview : skinEntry.darkPreview;
  const copy = copyForSurface(surface);

  return (
    <div
      data-mode={mode}
      data-skin={skin}
      data-font={fontPairing}
      data-surface={surface}
      className="min-w-0 overflow-hidden rounded-card border border-white/10"
      style={panelStyle(palette, fontEntry)}
    >
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] opacity-60">
          ROAMLOG / {mode === "light" ? "LIGHT" : "DARK"}
        </span>
        <span aria-hidden="true" className="size-2 rounded-full bg-[var(--preview-accent)]" />
      </div>
      <div className="space-y-3 p-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] opacity-55">
          {copy.eyebrow}
        </p>
        <h3
          className="text-[22px] leading-[1.08] tracking-[-0.03em]"
          style={{ fontFamily: fontEntry.displayStack }}
        >
          {copy.title}
        </h3>
        <p className="text-[11px] leading-5 opacity-75">{copy.body}</p>
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] opacity-50">
            {copy.meta}
          </span>
          <span
            className="rounded-full px-2.5 py-1 text-[9px] font-medium text-white"
            style={{ backgroundColor: palette.accent }}
          >
            {copy.action}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AppearancePreview({
  mode,
  skin,
  fontPairing,
  surface = "web",
}: AppearancePreviewProps) {
  if (mode === "system") {
    return (
      <div className="space-y-2" data-testid="appearance-preview-system">
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-stone">
          跟随系统：浅色 / 深色
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <PreviewPanel mode="light" skin={skin} fontPairing={fontPairing} surface={surface} />
          <PreviewPanel mode="dark" skin={skin} fontPairing={fontPairing} surface={surface} />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="appearance-preview-single">
      <PreviewPanel mode={mode} skin={skin} fontPairing={fontPairing} surface={surface} />
    </div>
  );
}
