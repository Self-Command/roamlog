"use client";

import {
  FONT_PAIRING_CATALOG,
  SKIN_CATALOG,
  type AppearanceMode,
  type FontPairingId,
  type SkinId,
} from "@roamlog/contracts";

interface WorkspaceAppearancePreviewProps {
  mode: AppearanceMode;
  skin: SkinId;
  fontPairing: FontPairingId;
}

function mix(color: string, base: string, amount: number): string {
  return `color-mix(in srgb, ${color} ${String(amount)}%, ${base})`;
}

function PreviewPane({
  mode,
  skin,
  fontPairing,
}: {
  mode: "light" | "dark";
  skin: SkinId;
  fontPairing: FontPairingId;
}) {
  const skinEntry = SKIN_CATALOG.find((entry) => entry.id === skin) ?? SKIN_CATALOG[0];
  const fontEntry =
    FONT_PAIRING_CATALOG.find((entry) => entry.id === fontPairing) ?? FONT_PAIRING_CATALOG[0];
  const palette = mode === "light" ? skinEntry.lightPreview : skinEntry.darkPreview;
  const border = mix(palette.ink, "transparent", 15);
  const surface = mix(palette.ink, palette.canvas, 5);
  const muted = mix(palette.ink, palette.canvas, 62);
  const disabled = mix(palette.ink, palette.canvas, 42);

  return (
    <div
      data-mode={mode}
      data-skin={skin}
      data-font={fontPairing}
      data-surface="workspace"
      data-testid="appearance-workspace-preview-pane"
      className="overflow-hidden rounded-control border text-[10px]"
      style={{
        backgroundColor: palette.canvas,
        borderColor: border,
        color: palette.ink,
        fontFamily: fontEntry.bodyStack,
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: border, backgroundColor: surface }}
      >
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-[3px]"
            style={{ backgroundColor: palette.accent }}
          />
          <span className="font-semibold">Roamlog</span>
          <span style={{ color: muted }}>/ 工作区</span>
        </div>
        <span
          className="rounded px-1.5 py-0.5 text-[8px] font-medium"
          style={{ backgroundColor: mix(palette.accent, palette.canvas, 12), color: palette.accent }}
        >
          {mode === "light" ? "浅色" : "深色"}
        </span>
      </div>

      <div className="grid grid-cols-[56px_minmax(0,1fr)]">
        <div className="border-r px-2 py-2" style={{ borderColor: border, backgroundColor: surface }}>
          {["总览", "旅行", "日志", "设置"].map((label, index) => (
            <div
              key={label}
              className="mb-1 flex items-center gap-1 rounded px-1.5 py-1 text-[8px]"
              style={
                index === 0
                  ? { backgroundColor: palette.accent, color: "#ffffff" }
                  : { color: muted }
              }
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{
                  backgroundColor: index === 0 ? "#ffffff" : disabled,
                }}
              />
              {label}
            </div>
          ))}
        </div>

        <div className="min-w-0 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[8px] uppercase tracking-[0.08em]" style={{ color: muted }}>
                工作区 / 总览
              </p>
              <p
                className="mt-1 text-[15px] font-semibold leading-5"
                style={{ fontFamily: fontEntry.displayStack }}
              >
                工作台
              </p>
            </div>
            <span
              className="rounded px-2 py-1 text-[8px] font-medium text-white"
              style={{ backgroundColor: palette.accent }}
            >
              新建
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {[
              ["本月项目", "12"],
              ["待处理", "3"],
            ].map(([label, value]) => (
              <div key={label} className="rounded border px-2 py-1.5" style={{ borderColor: border }}>
                <p className="text-[7px]" style={{ color: muted }}>
                  {label}
                </p>
                <p className="mt-0.5 text-[12px] font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-2 overflow-hidden rounded border" style={{ borderColor: border }}>
            <div
              className="grid grid-cols-[minmax(0,1fr)_44px] border-b px-2 py-1 text-[7px] font-medium"
              style={{ borderColor: border, color: muted, backgroundColor: surface }}
            >
              <span>最近更新</span>
              <span>状态</span>
            </div>
            {[
              ["Q4 差旅计划", "进行中"],
              ["团队知识库", "已同步"],
            ].map(([label, status]) => (
              <div
                key={label}
                className="grid grid-cols-[minmax(0,1fr)_44px] border-b px-2 py-1.5 last:border-b-0"
                style={{ borderColor: border }}
              >
                <span className="truncate">{label}</span>
                <span style={{ color: muted }}>{status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceAppearancePreview({
  mode,
  skin,
  fontPairing,
}: WorkspaceAppearancePreviewProps) {
  if (mode === "system") {
    return (
      <div className="grid gap-2" data-testid="appearance-workspace-preview-system">
        <PreviewPane mode="light" skin={skin} fontPairing={fontPairing} />
        <PreviewPane mode="dark" skin={skin} fontPairing={fontPairing} />
      </div>
    );
  }

  return (
    <div data-testid="appearance-workspace-preview-single">
      <PreviewPane mode={mode} skin={skin} fontPairing={fontPairing} />
    </div>
  );
}
