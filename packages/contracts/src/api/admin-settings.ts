import { z } from "zod";

import { IsoTimestampSchema } from "../common/ids";

/**
 * Runtime platform settings contracts.
 *
 * The API never echoes a secret: a secret item carries `secret: { hasValue,
 * last4 }` instead of `value`. Non-secret items carry a JSON `value` (which may
 * be `null` for nullable settings such as `seo.ogImageUrl`). Plaintext secrets
 * only leave the server through the explicit, audited reveal endpoint.
 */

export const SETTINGS_GROUPS = [
  "general",
  "seo",
  "theme",
  "mail",
  "storage",
  "media",
  "ai",
  "places",
  "limits",
] as const;
export const SystemSettingGroupSchema = z.enum(SETTINGS_GROUPS);
export type SystemSettingGroup = z.infer<typeof SystemSettingGroupSchema>;

/**
 * Display labels for the Admin settings console. The keys are wire values and
 * never change; only these labels are localized for the admin UI.
 */
export const SETTINGS_GROUP_LABELS: Record<SystemSettingGroup, string> = {
  general: "通用",
  seo: "SEO",
  theme: "主题",
  mail: "邮件",
  storage: "存储",
  media: "媒体",
  ai: "AI",
  places: "地点",
  limits: "限制",
};

export const SETTINGS_VALUE_TYPES = ["string", "number", "boolean", "json", "secret"] as const;
export const SystemSettingValueTypeSchema = z.enum(SETTINGS_VALUE_TYPES);
export type SystemSettingValueType = z.infer<typeof SystemSettingValueTypeSchema>;

/**
 * Color modes the runtime actually implements.
 *
 * `light` used to be offered even though `@roamlog/ui` only shipped dark
 * tokens: selecting it wrote `data-theme="light"` and a light `color-scheme`
 * but the canvas stayed dark, so it was an honest-to-goodness fake setting.
 * It is removed from the contract rather than shipped as a half-finished
 * palette. `system` is the only non-dark intent until a light token set lands;
 * today it renders with the same dark tokens.
 */
export const THEME_MODES = ["dark", "system"] as const;
export const ThemeModeSchema = z.enum(THEME_MODES);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

/**
 * Any JSON value a non-secret setting may hold (null included).
 *
 * Deliberately structural instead of `z.json()`: the recursive Zod helper makes
 * `zod-to-openapi` recurse without a base case, and every concrete value is
 * already validated by its per-key registry schema before it is stored.
 */
export const SettingValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
export type SettingValue = z.infer<typeof SettingValueSchema>;

export const SettingKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/, {
    message: "Setting keys look like group.field and use camelCase segments.",
  });

export const AdminSettingKeyParamsSchema = z
  .object({
    key: SettingKeySchema,
  })
  .strict();
export type AdminSettingKeyParams = z.infer<typeof AdminSettingKeyParamsSchema>;

export const AdminSettingSecretStateSchema = z
  .object({
    hasValue: z.boolean(),
    /** Last up to 4 characters of the plaintext, for operator recognition only. */
    last4: z.string().max(8).nullable(),
  })
  .strict();
export type AdminSettingSecretState = z.infer<typeof AdminSettingSecretStateSchema>;

export const AdminSettingItemSchema = z
  .object({
    key: SettingKeySchema,
    group: SystemSettingGroupSchema,
    type: SystemSettingValueTypeSchema,
    label: z.string().min(1).max(120),
    help: z.string().max(500).optional(),
    /** Allowed values for enum-like settings, so forms never hardcode them. */
    options: z.array(z.string().min(1).max(80)).optional(),
    /** Code default; a DB row (or env lock) overrides it. */
    default: SettingValueSchema,
    isSecret: z.boolean(),
    isPublic: z.boolean(),
    envLocked: z.boolean(),
    /** Present for non-secret settings only. */
    value: SettingValueSchema.optional(),
    /** Present for secret settings only; plaintext is never part of this shape. */
    secret: AdminSettingSecretStateSchema.optional(),
    updatedAt: IsoTimestampSchema.nullable(),
    updatedById: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.isSecret) {
      if (!item.secret) {
        context.addIssue({
          code: "custom",
          path: ["secret"],
          message: "Secret settings must be presented as { hasValue, last4 }.",
        });
      }
      if (item.value !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message: "Secret settings must never include a value.",
        });
      }
      return;
    }

    if (item.value === undefined) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Non-secret settings must include a value.",
      });
    }
    if (item.secret !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["secret"],
        message: "Only secret settings include secret state.",
      });
    }
  });
export type AdminSettingItem = z.infer<typeof AdminSettingItemSchema>;

export const AdminSettingsGroupSchema = z
  .object({
    group: SystemSettingGroupSchema,
    label: z.string().min(1).max(80),
    items: z.array(AdminSettingItemSchema),
  })
  .strict();
export type AdminSettingsGroup = z.infer<typeof AdminSettingsGroupSchema>;

export const AdminSettingsResponseSchema = z
  .object({
    groups: z.array(AdminSettingsGroupSchema),
    generatedAt: IsoTimestampSchema,
  })
  .strict();
export type AdminSettingsResponse = z.infer<typeof AdminSettingsResponseSchema>;

export const AdminSettingUpdateSchema = z
  .object({
    key: SettingKeySchema,
    value: SettingValueSchema,
  })
  .strict();
export type AdminSettingUpdate = z.infer<typeof AdminSettingUpdateSchema>;

export const UpdateAdminSettingsRequestSchema = z
  .object({
    updates: z.array(AdminSettingUpdateSchema).min(1).max(50),
  })
  .strict();
export type UpdateAdminSettingsRequest = z.infer<typeof UpdateAdminSettingsRequestSchema>;

export const AdminSettingUpdateResultSchema = z
  .object({
    key: SettingKeySchema,
    secret: z.boolean(),
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type AdminSettingUpdateResult = z.infer<typeof AdminSettingUpdateResultSchema>;

export const UpdateAdminSettingsResponseSchema = z
  .object({
    updated: z.array(AdminSettingUpdateResultSchema),
    /**
     * Cache generation after the write. `null` means Redis was unreachable and
     * the write still succeeded (instances converge on their 5s TTL).
     */
    version: z.number().int().nonnegative().nullable(),
    generatedAt: IsoTimestampSchema,
  })
  .strict();
export type UpdateAdminSettingsResponse = z.infer<typeof UpdateAdminSettingsResponseSchema>;

export const RevealAdminSettingRequestSchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();
export type RevealAdminSettingRequest = z.infer<typeof RevealAdminSettingRequestSchema>;

export const RevealAdminSettingResponseSchema = z
  .object({
    key: SettingKeySchema,
    value: z.string(),
    revealedAt: IsoTimestampSchema,
  })
  .strict();
export type RevealAdminSettingResponse = z.infer<typeof RevealAdminSettingResponseSchema>;

export const PublicSettingsResponseSchema = z
  .object({
    settings: z.record(SettingKeySchema, SettingValueSchema),
    generatedAt: IsoTimestampSchema,
  })
  .strict();
export type PublicSettingsResponse = z.infer<typeof PublicSettingsResponseSchema>;
