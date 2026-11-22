/**
 * Code-owned defaults for every runtime platform setting.
 *
 * This module is intentionally database-free: `SystemSetting` starts empty and
 * a missing row means "use the default below". Keeping defaults in code (rather
 * than seeding rows) means upgrading a default reaches existing deployments,
 * and a database reset can never silently change site behaviour. The admin UI
 * and the API registry both read this object, so the value a form shows before
 * the first save is exactly the value the API serves.
 */

export type SettingDefaultValue =
  string | number | boolean | null | SettingDefaultValue[] | { [key: string]: SettingDefaultValue };

/**
 * Values are placeholders that must stay valid for their registry Zod schema.
 * `null` marks a secret that has not been configured yet; secrets are written
 * through the encrypted column and never round-trip through this object.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  "site.title": "Roamlog",
  "site.description": "A collaborative travel journal for the trips you take together.",
  "general.defaultLanguage": "zh-CN",
  "general.defaultTimeZone": "Asia/Shanghai",
  "general.registrationEnabled": true,

  "seo.titleTemplate": "%s · Roamlog",
  "seo.descriptionTemplate": "Plan trips, keep a journal, and remember every stop together.",
  "seo.ogImageUrl": null,
  "seo.robots": "index,follow",
  "seo.sitemapEnabled": true,

  "theme.accent": "white",
  "theme.defaultSkin": "editorial-noir",
  "theme.defaultMode": "system",
  "theme.defaultFont": "editorial-classic",
  "theme.allowUserOverride": true,
  "theme.loginTagline": "Every trip deserves a memory.",

  "mail.provider": "smtp",
  "mail.from": "Roamlog <hello@roamlog.local>",
  "mail.resendApiKey": null,
  "mail.smtpHost": "localhost",
  "mail.smtpPort": 587,
  "mail.smtpUser": "",
  "mail.smtpPassword": null,

  "storage.endpoint": "http://localhost:9000",
  "storage.publicEndpoint": null,
  "storage.bucket": "roamlog",
  "storage.region": "us-east-1",
  "storage.accessKey": null,
  "storage.secretKey": null,
  "storage.forcePathStyle": true,

  "media.maxEdge": 2_000,
  "media.quality": 0.82,
  "media.targetBytes": 1_500_000,
  "media.keepOriginal": false,
  "media.livePhotoEnabled": true,
  "media.maxUploadBytes": 25_000_000,

  "ai.defaultProvider": "openai-chat",
  "ai.timeoutMs": 30_000,
  "ai.maxOutputTokens": 4_096,
  "ai.dailyQuota": 1_000,
  "ai.baseUrl": null,
  "ai.model": null,
  "ai.apiKey": null,
  // Off by default: the gateway's `modalities` metadata cannot prove a model
  // can read images, so the capability is an explicit operator opt-in.
  "ai.vision": false,

  "places.provider": "geoapify",
  "places.apiKey": null,
  "places.lang": "zh",
  "places.limit": 6,
  "places.cacheTtlSeconds": 900,
  "places.dailyQuota": 2_500,

  "limits.searchPerMinute": 30,
  "limits.uploadPerMinute": 10,
  // Upload ceilings the presign pipeline enforces at runtime (see
  // `limits-settings.consumer.ts`): 20 files, 25 MiB per file, 150 MiB per batch.
  "limits.uploadMaxFilesPerBatch": 20,
  "limits.uploadMaxFileBytes": 26_214_400,
  "limits.uploadMaxBatchBytes": 157_286_400,
} satisfies Record<string, SettingDefaultValue>);

export type DefaultSettingKey = keyof typeof DEFAULT_SETTINGS;

export function defaultSettingKeys(): DefaultSettingKey[] {
  return Object.keys(DEFAULT_SETTINGS) as DefaultSettingKey[];
}

export function hasDefaultSetting(key: string): key is DefaultSettingKey {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

/**
 * Deep-cloned defaults for callers that may mutate their copy (tests, admin
 * fixtures). No database connection is opened.
 */
export function defaultSettingsSnapshot(): Record<string, SettingDefaultValue> {
  return structuredClone(DEFAULT_SETTINGS);
}
