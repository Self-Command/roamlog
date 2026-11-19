import {
  SETTINGS_GROUP_LABELS,
  THEME_MODES,
  type SettingValue,
  type SystemSettingGroup,
  type SystemSettingValueType,
} from "@roamlog/contracts";
import { DEFAULT_SETTINGS, type SettingDefaultValue } from "@roamlog/db";
import { z } from "zod";

/**
 * Single source of truth for every operator-editable setting: group, type,
 * default, validation, visibility, and the labels the admin UI renders.
 *
 * Adding a key means adding it here (and to `DEFAULT_SETTINGS`). The registry is
 * immutable at runtime; `SettingsService` refuses unknown keys, and
 * `DEFAULT_SETTINGS` is checked at module load so a key can never exist without
 * a default.
 */

export interface SettingDefinition {
  readonly key: string;
  readonly group: SystemSettingGroup;
  readonly type: SystemSettingValueType;
  readonly defaultValue: SettingDefaultValue;
  readonly schema: z.ZodType;
  readonly isPublic: boolean;
  readonly isSecret: boolean;
  readonly envLocked: boolean;
  /** Environment variable that wins over the DB value when `envLocked`. */
  readonly envVar?: string;
  readonly label: string;
  readonly help: string;
  readonly options?: readonly string[];
}

/** DI token so tests/modules can swap the registry without touching the API. */
export const SETTINGS_REGISTRY_TOKEN = Symbol("roamlog:settings-registry");

const HTTP_URL = z
  .url()
  .max(2_048)
  .refine((value) => /^https?:\/\//u.test(value), {
    message: "Must be an http(s) URL.",
  });

const IANA_TIME_ZONE = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Must be an IANA time zone such as Asia/Shanghai." },
  );

const MAIL_FROM = z
  .string()
  .min(3)
  .max(320)
  .refine((value) => value.includes("@") && !/[\r\n]/u.test(value), {
    message: "Must be a mail address such as Roamlog <no-reply@example.com>.",
  });

const SECRET = z.string().min(1).max(4_096);

const THEME_ACCENTS = ["white", "amber", "blue", "emerald", "rose"] as const;
const LANGUAGES = ["zh-CN", "en"] as const;
const MAIL_PROVIDERS = ["resend", "smtp"] as const;
const PLACE_PROVIDERS = ["geoapify", "photon"] as const;

function define(entry: Omit<SettingDefinition, "defaultValue">): SettingDefinition {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, entry.key)) {
    throw new Error(`Setting ${entry.key} has no entry in DEFAULT_SETTINGS`);
  }
  const defaultValue = DEFAULT_SETTINGS[entry.key as keyof typeof DEFAULT_SETTINGS];
  if (defaultValue !== null) {
    const parsed = entry.schema.safeParse(defaultValue);
    if (!parsed.success) {
      throw new Error(
        `Default for ${entry.key} does not satisfy its schema: ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
  }
  return { ...entry, defaultValue };
}

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = Object.freeze([
  define({
    key: "site.title",
    group: "general",
    type: "string",
    schema: z.string().min(1).max(80),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Site title",
    help: "Shown in the browser tab, SEO titles, and the public site header.",
  }),
  define({
    key: "site.description",
    group: "general",
    type: "string",
    schema: z.string().min(1).max(300),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Site description",
    help: "Default meta description and the short line shown on public pages.",
  }),
  define({
    key: "general.defaultLanguage",
    group: "general",
    type: "string",
    schema: z.enum(LANGUAGES),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Default language",
    help: "Language used before a visitor or member picks one.",
    options: LANGUAGES,
  }),
  define({
    key: "general.defaultTimeZone",
    group: "general",
    type: "string",
    schema: IANA_TIME_ZONE,
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Default time zone",
    help: "IANA time zone used for new accounts and date rendering.",
  }),
  define({
    key: "general.registrationEnabled",
    group: "general",
    type: "boolean",
    schema: z.boolean(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Registration open",
    help: "Turn off to stop new accounts from self-registering.",
  }),

  // SEO values are public by design: the anonymous web shell has to render the
  // exact `<title>`, description, Open Graph image and robots directive that
  // operators configure here, and crawlers read the same values. None of them
  // is a credential or an internal parameter.
  define({
    key: "seo.titleTemplate",
    group: "seo",
    type: "string",
    schema: z.string().min(1).max(200),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Title template",
    help: "Use %s where the page title goes, for example %s · Roamlog.",
  }),
  define({
    key: "seo.descriptionTemplate",
    group: "seo",
    type: "string",
    schema: z.string().min(1).max(300),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Description template",
    help: "Default description for pages without their own.",
  }),
  define({
    key: "seo.ogImageUrl",
    group: "seo",
    type: "string",
    schema: HTTP_URL.nullable(),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Open Graph image",
    help: "Absolute URL of the social preview image. Leave empty to omit it.",
  }),
  define({
    key: "seo.robots",
    group: "seo",
    type: "string",
    schema: z.string().min(1).max(100),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Robots directive",
    help: "Value for the robots meta tag, for example index,follow.",
  }),
  define({
    key: "seo.sitemapEnabled",
    group: "seo",
    type: "boolean",
    schema: z.boolean(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Sitemap",
    help: "Publish /sitemap.xml for public trips.",
  }),

  define({
    key: "theme.accent",
    group: "theme",
    type: "string",
    schema: z.enum(THEME_ACCENTS),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Accent color",
    help: "Accent used across buttons, focus rings, and charts.",
    options: THEME_ACCENTS,
  }),
  define({
    key: "theme.defaultMode",
    group: "theme",
    type: "string",
    schema: z.enum(THEME_MODES),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Default color mode",
    help: "Dark, or system. A light palette is not available yet, so system currently renders dark.",
    options: THEME_MODES,
  }),
  define({
    key: "theme.loginTagline",
    group: "theme",
    type: "string",
    schema: z.string().max(160),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Login tagline",
    help: "Short line under the login heading.",
  }),

  define({
    key: "mail.provider",
    group: "mail",
    type: "string",
    schema: z.enum(MAIL_PROVIDERS),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Mail provider",
    help: "Resend or an SMTP relay. Credentials below match the selected provider.",
    options: MAIL_PROVIDERS,
  }),
  define({
    key: "mail.from",
    group: "mail",
    type: "string",
    schema: MAIL_FROM,
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "From address",
    help: "Sender shown on transactional mail.",
  }),
  define({
    key: "mail.resendApiKey",
    group: "mail",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "Resend API key",
    help: "Stored encrypted. Only the last four characters are shown.",
  }),
  define({
    key: "mail.smtpHost",
    group: "mail",
    type: "string",
    schema: z.string().min(1).max(255),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "SMTP host",
    help: "Relay hostname used when the provider is SMTP.",
  }),
  define({
    key: "mail.smtpPort",
    group: "mail",
    type: "number",
    schema: z.number().int().min(1).max(65_535),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "SMTP port",
    help: "Usually 587 for STARTTLS or 465 for implicit TLS.",
  }),
  define({
    key: "mail.smtpUser",
    group: "mail",
    type: "string",
    schema: z.string().max(255),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "SMTP user",
    help: "Username for the SMTP relay. May be empty for unauthenticated relays.",
  }),
  define({
    key: "mail.smtpPassword",
    group: "mail",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "SMTP password",
    help: "Stored encrypted and never returned by the settings API.",
  }),

  define({
    key: "storage.endpoint",
    group: "storage",
    type: "string",
    schema: HTTP_URL,
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Storage endpoint",
    help: "S3-compatible API endpoint the server signs against.",
  }),
  define({
    key: "storage.publicEndpoint",
    group: "storage",
    type: "string",
    schema: HTTP_URL.nullable(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Public endpoint",
    help: "Browser-facing origin for presigned URLs. Leave empty to reuse the endpoint.",
  }),
  define({
    key: "storage.bucket",
    group: "storage",
    type: "string",
    schema: z.string().min(1).max(255),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Bucket",
    help: "Bucket that stores media and exports.",
  }),
  define({
    key: "storage.region",
    group: "storage",
    type: "string",
    schema: z.string().min(1).max(64),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Region",
    help: "Signing region, for example us-east-1.",
  }),
  define({
    key: "storage.accessKey",
    group: "storage",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "Access key",
    help: "Stored encrypted; only the last four characters are shown.",
  }),
  define({
    key: "storage.secretKey",
    group: "storage",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "Secret key",
    help: "Stored encrypted and never returned by the settings API.",
  }),
  define({
    key: "storage.forcePathStyle",
    group: "storage",
    type: "boolean",
    schema: z.boolean(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Force path style",
    help: "Required by MinIO and some B2/Wasabi deployments.",
  }),

  // `media` is a mixed group: only the four values the browser compressor
  // genuinely reads are public. `keepOriginal` and `livePhotoEnabled` stay
  // private because neither behavior is wired yet — publishing them would let
  // the admin UI imply a switch works when it does not.
  define({
    key: "media.maxEdge",
    group: "media",
    type: "number",
    schema: z.number().int().min(500).max(8_000),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Max edge (px)",
    help: "Longest edge the browser keeps when compressing an image. The web client reads it from the public projection and clamps it to 500–4000.",
  }),
  define({
    key: "media.quality",
    group: "media",
    type: "number",
    schema: z.number().min(0.4).max(0.95),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "WebP quality",
    help: "Compression quality between 0.4 and 0.95. The browser starts its quality ladder at this value.",
  }),
  define({
    key: "media.targetBytes",
    group: "media",
    type: "number",
    schema: z.number().int().min(100_000).max(10_000_000),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Target bytes",
    help: "Size the client compressor aims for before uploading; the web client clamps it to 100 KB–5 MB.",
  }),
  define({
    key: "media.keepOriginal",
    group: "media",
    type: "boolean",
    schema: z.boolean(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Keep originals",
    help: "Upload the untouched original alongside the compressed derivative. 当前未接入：改动不影响上传行为。",
  }),
  define({
    key: "media.livePhotoEnabled",
    group: "media",
    type: "boolean",
    schema: z.boolean(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Live Photos",
    help: "Accept paired still/motion uploads from iOS. 当前未接入：改动不影响上传行为。",
  }),
  define({
    key: "media.maxUploadBytes",
    group: "media",
    type: "number",
    // The server hard-caps presigned uploads at 25 MiB (26,214,400 bytes). The
    // setting stops at the decimal 25 MB mark so an operator can never save a
    // value the presign endpoint would refuse; do not raise this without
    // changing the media module's cap at the same time.
    schema: z.number().int().min(1_000_000).max(25_000_000),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "Max upload bytes",
    help: "Largest single upload the presign endpoint accepts. 上限 25 MB，由服务端强制；客户端会先拦一次。",
  }),

  define({
    key: "ai.defaultProvider",
    group: "ai",
    type: "string",
    schema: z.string().min(1).max(80),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Default AI provider",
    help: "Provider id used when a workspace has no override.",
  }),
  define({
    key: "ai.timeoutMs",
    group: "ai",
    type: "number",
    schema: z.number().int().min(1_000).max(120_000),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Request timeout (ms)",
    help: "Per-request timeout for AI planning calls.",
  }),
  define({
    key: "ai.maxOutputTokens",
    group: "ai",
    type: "number",
    schema: z.number().int().min(256).max(65_536),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Max output tokens",
    help: "Upper bound passed to the provider.",
  }),
  define({
    key: "ai.dailyQuota",
    group: "ai",
    type: "number",
    schema: z.number().int().min(0).max(1_000_000),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Daily quota",
    help: "Platform-wide AI calls per day. Zero disables planning.",
  }),

  define({
    key: "places.provider",
    group: "places",
    type: "string",
    schema: z.enum(PLACE_PROVIDERS),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Places provider",
    help: "Geoapify first, Photon as the keyless fallback.",
    options: PLACE_PROVIDERS,
  }),
  define({
    key: "places.apiKey",
    group: "places",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "Places API key",
    help: "Stored encrypted; only the last four characters are shown.",
  }),
  define({
    key: "places.lang",
    group: "places",
    type: "string",
    schema: z.string().min(2).max(16),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Search language",
    help: "Language code passed to providers that support it.",
  }),
  define({
    key: "places.limit",
    group: "places",
    type: "number",
    schema: z.number().int().min(1).max(10),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Result limit",
    help: "Maximum suggestions returned per search.",
  }),
  define({
    key: "places.cacheTtlSeconds",
    group: "places",
    type: "number",
    schema: z.number().int().min(60).max(86_400),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Cache TTL (seconds)",
    help: "How long normalized place results stay cached.",
  }),
  define({
    key: "places.dailyQuota",
    group: "places",
    type: "number",
    schema: z.number().int().min(0).max(1_000_000),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Daily quota",
    help: "Provider calls per day before degrading to the fallback.",
  }),

  define({
    key: "limits.searchPerMinute",
    group: "limits",
    type: "number",
    schema: z.number().int().min(1).max(600),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Search requests / minute",
    help: "Per-account search rate limit.",
  }),
  define({
    key: "limits.uploadPerMinute",
    group: "limits",
    type: "number",
    schema: z.number().int().min(1).max(600),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "Uploads / minute",
    help: "Per-account presign rate limit.",
  }),
]);

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTINGS_REGISTRY.map((entry) => [entry.key, entry]),
);

export function requireSettingDefinition(key: string): SettingDefinition {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  return definition;
}

export function isSettingsGroup(value: string): value is SystemSettingGroup {
  return value in SETTINGS_GROUP_LABELS;
}

export function groupLabel(group: SystemSettingGroup): string {
  return SETTINGS_GROUP_LABELS[group];
}

/** Values the public projection may expose (non-secret, explicitly public). */
export function publicSettingDefinitions(): readonly SettingDefinition[] {
  return SETTINGS_REGISTRY.filter((entry) => entry.isPublic && !entry.isSecret);
}

export function settingsValueTypeOf(value: SettingValue): SystemSettingValueType {
  if (value === null || typeof value === "object") {
    return "json";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  return "string";
}
