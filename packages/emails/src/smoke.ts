import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { DEFAULT_EMAIL_FROM, renderSampleEmails } from "./render.js";

interface MailpitSendResponse {
  ID: string;
}

interface MailpitAddress {
  Email: string;
  Name?: string;
}

interface MailpitMessageList {
  total?: number;
  messages_count?: number;
}

function loadLocalEnvironment(): string | undefined {
  const explicit = process.env.ROAMLOG_ENV_FILE;
  const file = (
    explicit
      ? [resolve(explicit)]
      : [
          resolve(process.cwd(), ".env.local"),
          resolve(process.cwd(), "../../.env.local"),
          resolve(process.cwd(), ".env"),
          resolve(process.cwd(), "../../.env"),
        ]
  ).find((candidate) => existsSync(candidate));

  if (!file || (process.env.NODE_ENV === "production" && !explicit)) {
    return undefined;
  }

  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
  return file;
}

function mailpitBaseUrl(): string {
  const uiPort = process.env.MAILPIT_UI_PORT?.trim() || "8025";
  return (process.env.MAILPIT_URL?.trim() || `http://localhost:${uiPort}`).replace(/\/+$/, "");
}

function parseFrom(raw: string): MailpitAddress {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!match) {
    return { Email: raw.trim() };
  }
  const [, name, email] = match;
  return {
    Email: email ?? raw.trim(),
    ...(name?.trim() ? { Name: name.trim() } : {}),
  };
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Mailpit request failed: ${init?.method ?? "GET"} ${url} -> ${
        response.status
      }${body ? ` ${body.slice(0, 500)}` : ""}`,
    );
  }
  return response;
}

export async function runEmailSmoke(): Promise<Record<string, unknown>> {
  const environmentFile = loadLocalEnvironment();
  const baseUrl = mailpitBaseUrl();
  const recipient = {
    Email: process.env.SMOKE_EMAIL_TO?.trim() || "local@roamlog.test",
    Name: "Roamlog local inbox",
  };
  const from = parseFrom(process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM);

  await request(`${baseUrl}/livez`);
  const emails = await renderSampleEmails();
  const sent: Array<{ template: string; subject: string; id: string }> = [];

  for (const email of emails) {
    const response = await request(`${baseUrl}/api/v1/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        From: from,
        To: [recipient],
        Subject: email.subject,
        HTML: email.html,
        Text: email.text,
        Tags: ["roamlog-smoke"],
        Headers: {
          "X-Roamlog-Smoke": email.id,
        },
      }),
    });
    const result = (await response.json()) as MailpitSendResponse;
    sent.push({
      template: email.id,
      subject: email.subject,
      id: result.ID,
    });
  }

  const messagesResponse = await request(`${baseUrl}/api/v1/messages`);
  const messages = (await messagesResponse.json()) as MailpitMessageList;
  const total = messages.total ?? messages.messages_count ?? 0;

  return {
    mailpitUrl: baseUrl,
    environmentFile,
    sent,
    mailboxTotal: total,
  };
}

runEmailSmoke()
  .then((result) => {
    console.log(JSON.stringify({ status: "ok", ...result }, null, 2));
  })
  .catch((error: unknown) => {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
