import { z } from "zod";

import { IsoTimestampSchema, UuidV7Schema } from "../common/ids";

/**
 * Appearance is a three-way product preference, not a binary dark-mode flag.
 * `system` is the default and must be resolved against `prefers-color-scheme`.
 */
export const APPEARANCE_MODES = ["system", "light", "dark"] as const;
export const AppearanceModeSchema = z.enum(APPEARANCE_MODES);
export type AppearanceMode = z.infer<typeof AppearanceModeSchema>;

/**
 * Enterprise skins shown in the primary picker. Porcelain is the current
 * native default; the other enterprise skins remain available for users who
 * explicitly selected them.
 */
export const ACTIVE_SKIN_IDS = ["porcelain", "fluent", "carbon", "carbon-soft"] as const;
export type ActiveSkinId = (typeof ACTIVE_SKIN_IDS)[number];

/**
 * Old developer/editor palettes retained only for stored-value compatibility.
 * `normalizeSkinId()` maps every legacy ID to an enterprise skin before a
 * cookie or DB value reaches the renderer.
 */
export const LEGACY_SKIN_IDS = [
  "primer",
  "editorial-noir",
  "catppuccin",
  "tokyo-night",
  "rose-pine",
  "kanagawa",
  "everforest",
] as const;
export type LegacySkinId = (typeof LEGACY_SKIN_IDS)[number];

/** Every skin ID persisted by platform settings and user preferences. */
export const SKIN_IDS = [...ACTIVE_SKIN_IDS, ...LEGACY_SKIN_IDS] as const;
export const SkinIdSchema = z.enum(SKIN_IDS);
export type SkinId = z.infer<typeof SkinIdSchema>;
export const DEFAULT_SKIN_ID: SkinId = "porcelain";

export const LEGACY_SKIN_TARGETS: Readonly<Record<LegacySkinId, ActiveSkinId>> = {
  primer: "fluent",
  "editorial-noir": "fluent",
  catppuccin: "fluent",
  "tokyo-night": "carbon",
  "rose-pine": "fluent",
  kanagawa: "carbon-soft",
  everforest: "carbon-soft",
};

/**
 * The single compatibility resolver. Web SSR, cookies, the API and Admin must
 * all use this function instead of maintaining separate mappings.
 */
export function normalizeSkinId(value: string | null | undefined): SkinId {
  if (typeof value !== "string") return DEFAULT_SKIN_ID;
  if ((ACTIVE_SKIN_IDS as readonly string[]).includes(value)) return value as SkinId;
  return LEGACY_SKIN_TARGETS[value as LegacySkinId] ?? DEFAULT_SKIN_ID;
}

/** Enterprise font pairings shown by default. */
export const ACTIVE_FONT_PAIRING_IDS = [
  "fluent-native",
  "primer-system",
  "primer-cjk",
  "carbon-plex",
] as const;
export type ActiveFontPairingId = (typeof ACTIVE_FONT_PAIRING_IDS)[number];

/** Legacy pairings stay parseable for existing cookies and DB rows. */
export const LEGACY_FONT_PAIRING_IDS = [
  "editorial-classic",
  "literary-warm",
  "modern-editorial",
  "expressive-serif",
  "cjk-editorial",
  "swiss-modern",
] as const;
export type LegacyFontPairingId = (typeof LEGACY_FONT_PAIRING_IDS)[number];

export const FONT_PAIRING_IDS = [
  ...ACTIVE_FONT_PAIRING_IDS,
  ...LEGACY_FONT_PAIRING_IDS,
] as const;
export const FontPairingIdSchema = z.enum(FONT_PAIRING_IDS);
export type FontPairingId = z.infer<typeof FontPairingIdSchema>;
export const DEFAULT_FONT_PAIRING_ID: FontPairingId = "fluent-native";

export const LEGACY_FONT_PAIRING_TARGETS: Readonly<
  Record<LegacyFontPairingId, ActiveFontPairingId>
> = {
  "editorial-classic": "fluent-native",
  "literary-warm": "fluent-native",
  "modern-editorial": "fluent-native",
  "expressive-serif": "fluent-native",
  "cjk-editorial": "fluent-native",
  "swiss-modern": "fluent-native",
};

export function normalizeFontPairingId(value: string | null | undefined): FontPairingId {
  if (typeof value !== "string") return DEFAULT_FONT_PAIRING_ID;
  if ((ACTIVE_FONT_PAIRING_IDS as readonly string[]).includes(value)) return value as FontPairingId;
  return LEGACY_FONT_PAIRING_TARGETS[value as LegacyFontPairingId] ?? DEFAULT_FONT_PAIRING_ID;
}

export interface AppearancePreviewColors {
  canvas: string;
  ink: string;
  accent: string;
}

export interface SkinCatalogEntry {
  id: SkinId;
  status: "active" | "legacy";
  label: string;
  description: string;
  lightPreview: AppearancePreviewColors;
  darkPreview: AppearancePreviewColors;
  sourceId: string;
  licenseId: "MIT" | "Apache-2.0" | "internal";
}

/**
 * Curated palettes. Upstream skins keep their pinned source metadata;
 * Porcelain is marked internal because Roamlog owns the approved palette.
 */
export const SKIN_CATALOG = [
  {
    id: "porcelain",
    status: "active",
    label: "Porcelain 原生瓷白",
    description: "低饱和瓷白、磨砂表面与单一深墨动作色，保留系统级原生分层。",
    lightPreview: { canvas: "#f6f5f2", ink: "#1d1d1f", accent: "#1f2022" },
    darkPreview: { canvas: "#141416", ink: "#f2f1ee", accent: "#f2f1ee" },
    sourceId: "roamlog-porcelain",
    licenseId: "internal",
  },
  {
    id: "fluent",
    status: "active",
    label: "Fluent 2 原生企业",
    description: "Microsoft Fluent 2 的中性灰表面、品牌蓝与亲和控件状态。",
    lightPreview: { canvas: "#ffffff", ink: "#242424", accent: "#0f6cbd" },
    darkPreview: { canvas: "#292929", ink: "#ffffff", accent: "#115ea3" },
    sourceId: "fluentui-react-theme@9.2.2",
    licenseId: "MIT",
  },
  {
    id: "carbon",
    status: "active",
    label: "IBM Carbon",
    description: "高密度 Carbon White / Gray 100，清晰边框与零装饰控制台。",
    lightPreview: { canvas: "#ffffff", ink: "#161616", accent: "#0f62fe" },
    darkPreview: { canvas: "#161616", ink: "#f4f4f4", accent: "#0f62fe" },
    sourceId: "carbon-themes@11.86.0",
    licenseId: "Apache-2.0",
  },
  {
    id: "carbon-soft",
    status: "active",
    label: "Carbon 柔和灰阶",
    description: "Carbon Gray 10 / Gray 90 低对比背景，适合长时间密集工作。",
    lightPreview: { canvas: "#f4f4f4", ink: "#161616", accent: "#0f62fe" },
    darkPreview: { canvas: "#262626", ink: "#f4f4f4", accent: "#78a9ff" },
    sourceId: "carbon-themes@11.86.0",
    licenseId: "Apache-2.0",
  },
  {
    id: "primer",
    status: "legacy",
    label: "Primer（旧版）",
    description: "GitHub Primer 旧版兼容主题；新界面统一使用 Fluent 2 原生企业主题。",
    lightPreview: { canvas: "#ffffff", ink: "#1f2328", accent: "#1f883d" },
    darkPreview: { canvas: "#0d1117", ink: "#f0f6fc", accent: "#238636" },
    sourceId: "primer-primitives@11.10.0",
    licenseId: "MIT",
  },
  {
    id: "editorial-noir",
    status: "legacy",
    label: "编辑黑",
    description: "当前 Roamlog 黑色基线 × Radix sand/orange 明亮角色。",
    lightPreview: { canvas: "#f9f9f8", ink: "#1c1c19", accent: "#f76b15" },
    darkPreview: { canvas: "#000000", ink: "#fcfdff", accent: "#ff801f" },
    sourceId: "radix-colors",
    licenseId: "MIT",
  },
  {
    id: "catppuccin",
    status: "legacy",
    label: "猫咖",
    description: "Catppuccin Latte / Mocha，柔和表面与清晰层级。",
    lightPreview: { canvas: "#eff1f5", ink: "#4c4f69", accent: "#fe640b" },
    darkPreview: { canvas: "#1e1e2e", ink: "#cdd6f4", accent: "#fab387" },
    sourceId: "catppuccin-palette",
    licenseId: "MIT",
  },
  {
    id: "tokyo-night",
    status: "legacy",
    label: "东京夜",
    description: "Tokyo Night Day / Storm，冷调蓝紫与高对比强调色。",
    lightPreview: { canvas: "#e1e2e7", ink: "#3760bf", accent: "#2e7de9" },
    darkPreview: { canvas: "#24283b", ink: "#c0caf5", accent: "#7aa2f7" },
    sourceId: "tokyo-night",
    licenseId: "Apache-2.0",
  },
  {
    id: "rose-pine",
    status: "legacy",
    label: "玫瑰松",
    description: "Rosé Pine Dawn / Moon，低饱和玫瑰与松绿。",
    lightPreview: { canvas: "#faf4ed", ink: "#575279", accent: "#d7827e" },
    darkPreview: { canvas: "#232136", ink: "#e0def4", accent: "#ea9a97" },
    sourceId: "rose-pine",
    licenseId: "MIT",
  },
  {
    id: "kanagawa",
    status: "legacy",
    label: "神奈川",
    description: "Kanagawa Lotus / Wave，日式墨色与靛蓝层次。",
    lightPreview: { canvas: "#f2ecbc", ink: "#545464", accent: "#c84053" },
    darkPreview: { canvas: "#1f1f28", ink: "#dcd7ba", accent: "#7e9cd8" },
    sourceId: "kanagawa",
    licenseId: "MIT",
  },
  {
    id: "everforest",
    status: "legacy",
    label: "常青林",
    description: "Everforest Light / Dark medium，自然中性色与苔绿。",
    lightPreview: { canvas: "#fdf6e3", ink: "#5c6a72", accent: "#8da101" },
    darkPreview: { canvas: "#2d353b", ink: "#d3c6aa", accent: "#a7c080" },
    sourceId: "everforest",
    licenseId: "MIT",
  },
] as const satisfies readonly SkinCatalogEntry[];

export interface FontPairingCatalogEntry {
  id: FontPairingId;
  status: "active" | "legacy";
  label: string;
  description: string;
  displayStack: string;
  bodyStack: string;
  monoStack: string;
  licenseId: "OFL-1.1" | "system";
  licenseSource: string;
}

/**
 * Every family is bundled through its Fontsource package. Stacks include the
 * CJK fallback because the display/body Latin faces do not cover Chinese.
 */
export const FONT_PAIRING_CATALOG = [
  {
    id: "fluent-native",
    status: "active",
    label: "Fluent 原生",
    description: "Segoe UI 与系统字体栈，Windows 上呈现原生 Fluent 排版。",
    displayStack:
      '"Segoe UI", -apple-system, BlinkMacSystemFont, "Noto Sans SC Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Roboto, "Helvetica Neue", sans-serif',
    bodyStack:
      '"Segoe UI", -apple-system, BlinkMacSystemFont, "Noto Sans SC Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Roboto, "Helvetica Neue", sans-serif',
    monoStack: 'Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, monospace',
    licenseId: "system",
    licenseSource: "https://github.com/microsoft/fluentui",
  },
  {
    id: "primer-system",
    status: "active",
    label: "Primer 系统",
    description: "Mona Sans + Noto Sans SC + 系统回退，Primer 企业默认。",
    displayStack:
      '"Mona Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC Variable", "Noto Sans SC", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
    bodyStack:
      '"Mona Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC Variable", "Noto Sans SC", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
    monoStack:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/github/mona-sans/blob/main/LICENSE",
  },
  {
    id: "primer-cjk",
    status: "active",
    label: "Primer 中文",
    description: "Noto Sans SC 中文优先，配合系统 UI 与 Primer 等宽数字。",
    displayStack:
      '"Noto Sans SC Variable", "Noto Sans SC", ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    bodyStack:
      '"Noto Sans SC Variable", "Noto Sans SC", ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    monoStack:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE",
  },
  {
    id: "carbon-plex",
    status: "active",
    label: "Carbon Plex",
    description: "IBM Plex Sans 与 Plex Mono，适合数据密集和高密度操作。",
    displayStack:
      '"IBM Plex Sans Variable", "Noto Sans SC Variable", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
    bodyStack:
      '"IBM Plex Sans Variable", "Noto Sans SC Variable", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
    monoStack: '"IBM Plex Mono", "Noto Sans SC", ui-monospace, SFMono-Regular, monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/IBM/plex/blob/master/LICENSE.txt",
  },
  {
    id: "editorial-classic",
    status: "legacy",
    label: "经典编辑",
    description: "当前品牌基线：Instrument Serif + Geist + Noto SC。",
    displayStack: '"Instrument Serif", "Noto Serif SC", Georgia, serif',
    bodyStack: '"Geist", "Noto Sans SC", system-ui, sans-serif',
    monoStack: '"Geist Mono", ui-monospace, SFMono-Regular, monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/Instrument/instrument-serif/blob/main/OFL.txt",
  },
  {
    id: "literary-warm",
    status: "legacy",
    label: "文学暖调",
    description: "Newsreader + Manrope，适合长篇旅行日志。",
    displayStack: '"Newsreader", "Noto Serif SC", Georgia, serif',
    bodyStack: '"Manrope", "Noto Sans SC", system-ui, sans-serif',
    monoStack: '"JetBrains Mono", ui-monospace, monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/productiontype/Newsreader/blob/main/OFL.txt",
  },
  {
    id: "modern-editorial",
    status: "legacy",
    label: "现代编辑",
    description: "Instrument Serif + Inter，密集产品界面仍保留编辑气质。",
    displayStack: '"Instrument Serif", "Noto Serif SC", Georgia, serif',
    bodyStack: '"Inter", "Noto Sans SC", system-ui, sans-serif',
    monoStack: '"Geist Mono", ui-monospace, monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/rsms/inter/blob/master/LICENSE.txt",
  },
  {
    id: "expressive-serif",
    status: "legacy",
    label: "表达衬线",
    description: "Fraunces + Inter，最高编辑对比与当代表达。",
    displayStack: '"Fraunces", "Noto Serif SC", Georgia, serif',
    bodyStack: '"Inter", "Noto Sans SC", system-ui, sans-serif',
    monoStack: '"JetBrains Mono", ui-monospace, monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/undercasetype/Fraunces/blob/master/OFL.txt",
  },
  {
    id: "cjk-editorial",
    status: "legacy",
    label: "中文编辑",
    description: "Noto Serif SC + Noto Sans SC，中文优先的阅读节奏。",
    displayStack: '"Noto Serif SC", Georgia, serif',
    bodyStack: '"Noto Sans SC", system-ui, sans-serif',
    monoStack: '"Geist Mono", ui-monospace, monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/notofonts/noto-cjk/blob/main/Serif/LICENSE",
  },
  {
    id: "swiss-modern",
    status: "legacy",
    label: "瑞士现代",
    description: "Geist + JetBrains Mono，最大清晰度与中性产品感。",
    displayStack: '"Geist", "Noto Serif SC", system-ui, sans-serif',
    bodyStack: '"Geist", "Noto Sans SC", system-ui, sans-serif',
    monoStack: '"JetBrains Mono", ui-monospace, monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/vercel/geist-font/blob/main/LICENSE.txt",
  },
] as const satisfies readonly FontPairingCatalogEntry[];

export const ACTIVE_SKIN_CATALOG = SKIN_CATALOG.filter(
  (entry) => entry.status === "active",
);
export const ACTIVE_FONT_PAIRING_CATALOG = FONT_PAIRING_CATALOG.filter(
  (entry) => entry.status === "active",
);

/** Stored preference fields. `null` means "inherit the platform default". */
export const AppearancePreferenceSchema = z
  .object({
    mode: AppearanceModeSchema.nullable(),
    skin: SkinIdSchema.nullable(),
    fontPairing: FontPairingIdSchema.nullable(),
  })
  .strict();
export type AppearancePreference = z.infer<typeof AppearancePreferenceSchema>;

/** Partial update; at least one override must be present. */
export const UpdateAppearancePreferenceSchema = z
  .object({
    mode: AppearanceModeSchema.nullable().optional(),
    skin: SkinIdSchema.nullable().optional(),
    fontPairing: FontPairingIdSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one appearance field is required.",
  });
export type UpdateAppearancePreference = z.infer<typeof UpdateAppearancePreferenceSchema>;

export const AppearanceDefaultsSchema = z
  .object({
    mode: AppearanceModeSchema,
    skin: SkinIdSchema,
    fontPairing: FontPairingIdSchema,
  })
  .strict();
export type AppearanceDefaults = z.infer<typeof AppearanceDefaultsSchema>;

export const APPEARANCE_SOURCES = ["cookie", "user", "platform", "default"] as const;
export const AppearanceSourceSchema = z.enum(APPEARANCE_SOURCES);
export type AppearanceSource = z.infer<typeof AppearanceSourceSchema>;

export const ResolvedAppearanceSchema = z
  .object({
    mode: AppearanceModeSchema,
    skin: SkinIdSchema,
    fontPairing: FontPairingIdSchema,
    source: AppearanceSourceSchema,
    canOverride: z.boolean(),
    updatedAt: IsoTimestampSchema.nullable(),
    defaults: AppearanceDefaultsSchema,
  })
  .strict();
export type ResolvedAppearance = z.infer<typeof ResolvedAppearanceSchema>;

function ownField<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }, schema.optional());
}

/**
 * The first-paint cookie. Unknown/invalid individual fields are omitted while
 * valid siblings survive; this prevents a stale skin ID from blanking the page.
 */
export const AppearanceCookieSchema = z.object({
  v: z.literal(1),
  mode: ownField(AppearanceModeSchema),
  skin: ownField(SkinIdSchema),
  fontPairing: ownField(FontPairingIdSchema),
  uid: ownField(UuidV7Schema),
  updatedAt: ownField(IsoTimestampSchema),
});
export type AppearanceCookie = z.infer<typeof AppearanceCookieSchema>;
