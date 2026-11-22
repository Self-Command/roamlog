import { z } from "zod";

import { IsoTimestampSchema, UuidV7Schema } from "../common/ids";

/**
 * Appearance is a three-way product preference, not a binary dark-mode flag.
 * `system` is the default and must be resolved against `prefers-color-scheme`.
 */
export const APPEARANCE_MODES = ["system", "light", "dark"] as const;
export const AppearanceModeSchema = z.enum(APPEARANCE_MODES);
export type AppearanceMode = z.infer<typeof AppearanceModeSchema>;

/** The only skin IDs persisted by platform settings and user preferences. */
export const SKIN_IDS = [
  "editorial-noir",
  "catppuccin",
  "tokyo-night",
  "rose-pine",
  "kanagawa",
  "everforest",
] as const;
export const SkinIdSchema = z.enum(SKIN_IDS);
export type SkinId = z.infer<typeof SkinIdSchema>;

/** The only locally bundled font pairings exposed by the product. */
export const FONT_PAIRING_IDS = [
  "editorial-classic",
  "literary-warm",
  "modern-editorial",
  "expressive-serif",
  "cjk-editorial",
  "swiss-modern",
] as const;
export const FontPairingIdSchema = z.enum(FONT_PAIRING_IDS);
export type FontPairingId = z.infer<typeof FontPairingIdSchema>;

export interface AppearancePreviewColors {
  canvas: string;
  ink: string;
  accent: string;
}

export interface SkinCatalogEntry {
  id: SkinId;
  label: string;
  description: string;
  lightPreview: AppearancePreviewColors;
  darkPreview: AppearancePreviewColors;
  sourceId: string;
  licenseId: "MIT" | "Apache-2.0";
}

/**
 * Curated, legally sourced palettes. Values are previews of the upstream
 * semantic roles; the full token port lives in the shared UI stylesheet.
 */
export const SKIN_CATALOG = [
  {
    id: "editorial-noir",
    label: "编辑黑",
    description: "当前 Roamlog 黑色基线 × Radix sand/orange 明亮角色。",
    lightPreview: { canvas: "#f9f9f8", ink: "#1c1c19", accent: "#f76b15" },
    darkPreview: { canvas: "#000000", ink: "#fcfdff", accent: "#ff801f" },
    sourceId: "radix-colors",
    licenseId: "MIT",
  },
  {
    id: "catppuccin",
    label: "猫咖",
    description: "Catppuccin Latte / Mocha，柔和表面与清晰层级。",
    lightPreview: { canvas: "#eff1f5", ink: "#4c4f69", accent: "#fe640b" },
    darkPreview: { canvas: "#1e1e2e", ink: "#cdd6f4", accent: "#fab387" },
    sourceId: "catppuccin-palette",
    licenseId: "MIT",
  },
  {
    id: "tokyo-night",
    label: "东京夜",
    description: "Tokyo Night Day / Storm，冷调蓝紫与高对比强调色。",
    lightPreview: { canvas: "#e1e2e7", ink: "#3760bf", accent: "#2e7de9" },
    darkPreview: { canvas: "#24283b", ink: "#c0caf5", accent: "#7aa2f7" },
    sourceId: "tokyo-night",
    licenseId: "Apache-2.0",
  },
  {
    id: "rose-pine",
    label: "玫瑰松",
    description: "Rosé Pine Dawn / Moon，低饱和玫瑰与松绿。",
    lightPreview: { canvas: "#faf4ed", ink: "#575279", accent: "#d7827e" },
    darkPreview: { canvas: "#232136", ink: "#e0def4", accent: "#ea9a97" },
    sourceId: "rose-pine",
    licenseId: "MIT",
  },
  {
    id: "kanagawa",
    label: "神奈川",
    description: "Kanagawa Lotus / Wave，日式墨色与靛蓝层次。",
    lightPreview: { canvas: "#f2ecbc", ink: "#545464", accent: "#c84053" },
    darkPreview: { canvas: "#1f1f28", ink: "#dcd7ba", accent: "#7e9cd8" },
    sourceId: "kanagawa",
    licenseId: "MIT",
  },
  {
    id: "everforest",
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
  label: string;
  description: string;
  displayStack: string;
  bodyStack: string;
  monoStack: string;
  licenseId: "OFL-1.1";
  licenseSource: string;
}

/**
 * Every family is bundled through its Fontsource package. Stacks include the
 * CJK fallback because the display/body Latin faces do not cover Chinese.
 */
export const FONT_PAIRING_CATALOG = [
  {
    id: "editorial-classic",
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
    label: "瑞士现代",
    description: "Geist + JetBrains Mono，最大清晰度与中性产品感。",
    displayStack: '"Geist", "Noto Serif SC", system-ui, sans-serif',
    bodyStack: '"Geist", "Noto Sans SC", system-ui, sans-serif',
    monoStack: '"JetBrains Mono", ui-monospace, monospace',
    licenseId: "OFL-1.1",
    licenseSource: "https://github.com/vercel/geist-font/blob/main/LICENSE.txt",
  },
] as const satisfies readonly FontPairingCatalogEntry[];

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
