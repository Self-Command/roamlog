/**
 * Acceptance helpers for `AVATAR_EMAIL_FIX`.
 *
 * No mocks and no direct seeding of the account under test: the account is
 * created through the real `POST /v1/auth/sign-up/email` route, then verified by
 * clicking the link the app itself mailed into the local Mailpit sink. The
 * only direct database access is *reading* evidence (the stored avatar value,
 * the EmailLog row, the final address), because the API has no endpoint that
 * exposes those columns.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export const ACCEPTANCE_API_URL = process.env.ROAMLOG_ACCEPTANCE_API_URL ?? "http://127.0.0.1:4173";
export const ACCEPTANCE_WEB_URL = process.env.ROAMLOG_ACCEPTANCE_WEB_URL ?? "http://127.0.0.1:3200";
export const ACCEPTANCE_DATABASE_URL =
  process.env.ROAMLOG_ACCEPTANCE_DATABASE_URL ??
  "postgresql://roamlog:roamlog@127.0.0.1:55444/roamlog_local?schema=public";
export const ACCEPTANCE_MAILPIT_URL =
  process.env.ROAMLOG_ACCEPTANCE_MAILPIT_URL ?? "http://127.0.0.1:8025";
export const ACCEPTANCE_PASSWORD = "Roamlog-Avatar-Aa1!";

export interface AcceptanceUser {
  id?: string;
  email: string;
  name: string;
  password: string;
}

export interface CapturedMail {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Reads the Mailpit sink (a local SMTP capture, not a real inbox). */
export async function listCapturedMail(recipient: string): Promise<CapturedMail[]> {
  const list = await fetch(`${ACCEPTANCE_MAILPIT_URL}/api/v1/messages?limit=200`);
  if (!list.ok) {
    throw new Error(`Mailpit list failed: ${list.status}`);
  }
  const container = (await list.json()) as {
    messages?: {
      ID: string;
      To?: { Address?: string }[];
      Subject?: string;
    }[];
  };
  const wanted = (container.messages ?? []).filter((message) =>
    (message.To ?? []).some((entry) => entry.Address?.toLowerCase() === recipient.toLowerCase()),
  );
  return await Promise.all(
    wanted.map(async (message) => {
      const response = await fetch(`${ACCEPTANCE_MAILPIT_URL}/api/v1/message/${message.ID}`);
      if (!response.ok) {
        throw new Error(`Mailpit message ${message.ID} failed: ${response.status}`);
      }
      const body = (await response.json()) as { Text?: string; HTML?: string };
      return {
        id: message.ID,
        to: recipient,
        subject: message.Subject ?? "",
        text: body.Text ?? "",
        html: body.HTML ?? "",
      };
    }),
  );
}

/** Polls Mailpit until a matching message lands. */
export async function waitForCapturedMail(
  recipient: string,
  predicate: (mail: CapturedMail) => boolean,
  timeoutMs = 25_000,
): Promise<CapturedMail> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = (await listCapturedMail(recipient)).find(predicate);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No captured mail for ${recipient} within ${timeoutMs}ms`);
}

/** Extracts the first absolute verification URL from a captured message. */
export function verificationUrlFrom(mail: CapturedMail, apiUrl = ACCEPTANCE_API_URL): string | null {
  const escaped = apiUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}/v1/auth/verify-email\\?[^\\s"'<>\\]]+`, "i");
  const match = pattern.exec(mail.text) ?? pattern.exec(mail.html);
  return match ? match[0].replaceAll("&amp;", "&") : null;
}

/**
 * Creates and verifies a throw-away account through the public sign-up route.
 * Returns the credentials the settings pages accept.
 */
export async function signUpVerifiedAccount(label: string): Promise<AcceptanceUser> {
  const email = `${label}-${Date.now().toString(36)}@roamlog.test`;
  const name = `验收账号 ${label}`;
  const signUp = await fetch(`${ACCEPTANCE_API_URL}/v1/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ACCEPTANCE_WEB_URL },
    body: JSON.stringify({ name, email, password: ACCEPTANCE_PASSWORD }),
  });
  if (!signUp.ok) {
    throw new Error(`sign-up failed: ${signUp.status} ${await signUp.text()}`);
  }

  const mail = await waitForCapturedMail(email, (entry) =>
    entry.subject.includes("验证你的 Roamlog 邮箱"),
  );
  const url = verificationUrlFrom(mail);
  if (!url) {
    throw new Error(`verification mail for ${email} carries no link`);
  }
  const verified = await fetch(url, { redirect: "manual" });
  if (verified.status >= 400) {
    throw new Error(`verification link failed: ${verified.status}`);
  }

  return { email, name, password: ACCEPTANCE_PASSWORD };
}

/* ------------------------------------------------------------------ */
/* Read-only database evidence                                        */
/* ------------------------------------------------------------------ */

function openDatabase(): {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  close: () => Promise<void>;
} {
  const pg = require(`${__dirname}/../../node_modules/.pnpm/pg@8.23.1/node_modules/pg`);
  const url = new URL(ACCEPTANCE_DATABASE_URL);
  const client = new pg.Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionTimeoutMillis: 5_000,
  });
  return {
    async query(sql, values) {
      await client.connect();
      try {
        return await client.query(sql, values);
      } finally {
        await client.end();
      }
    },
    async close() {
      await client.end().catch(() => undefined);
    },
  };
}

export interface StoredUserRow {
  id: string;
  email: string;
  image: string | null;
}

export async function readUserByEmail(email: string): Promise<StoredUserRow | null> {
  const db = openDatabase();
  const result = await db.query('select id, email, image from "User" where lower(email) = lower($1)', [
    email,
  ]);
  const row = result.rows[0];
  return row ? { id: String(row.id), email: String(row.email), image: (row.image as string) ?? null } : null;
}

export async function readUserById(id: string): Promise<StoredUserRow | null> {
  const db = openDatabase();
  const result = await db.query('select id, email, image from "User" where id = $1', [id]);
  const row = result.rows[0];
  return row ? { id: String(row.id), email: String(row.email), image: (row.image as string) ?? null } : null;
}

export interface EmailLogRow {
  to: string;
  template: string;
  status: string;
}

export async function readEmailLogs(recipient: string): Promise<EmailLogRow[]> {
  const db = openDatabase();
  const result = await db.query(
    'select "to", template, status from "EmailLog" where lower("to") = lower($1) order by "createdAt" desc limit 20',
    [recipient],
  );
  return result.rows.map((row) => ({
    to: String(row.to),
    template: String(row.template),
    status: String(row.status),
  }));
}