/**
 * Accounts and session helpers for the deployment smoke suite.
 *
 * The suite runs against the repository's local dev stack (`localhost:3000`
 * web, `localhost:3001` admin, `localhost:4000` API) and has to log in with
 * real Better Auth credentials — no fixtures, no fake cookies.
 *
 * Accounts:
 * - owner/viewer come from the demo seed (`apps/db` seed) and are the same
 *   accounts the G3 viewer journeys use;
 * - `super_admin` has no seed account, so `provision.ts` creates one unique to
 *   the run and `cleanup` deletes it again. The password is test-only and local
 *   to this machine; it is never used outside `@roamlog.test`.
 *
 * Passwords live here only. Specs import the accounts, never the strings.
 */
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execSync } from "node:child_process";

import { currentTotp } from "../live-support/fixture";

export const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";

/**
 * Local development database used by the running stack. Override with
 * `E2E_SMOKE_DATABASE_URL` for another machine/port. CI supplies the database
 * through the top-level `DATABASE_URL`. The smoke suite never truncates this
 * database; it only adds a uniquely named super_admin and a uniquely titled
 * trip, and removes both again.
 */
export const SMOKE_DATABASE_URL =
  process.env.E2E_SMOKE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public";

export const WORKSPACE_SLUG = process.env.E2E_SMOKE_WORKSPACE_SLUG ?? "verify-crew";

export interface SmokeAccount {
  email: string;
  password: string;
  name: string;
}

export const OWNER_ACCOUNT: SmokeAccount = {
  email: "verify@roamlog.test",
  password: "Roamlog-Verify-Aa1!",
  name: "验收账号",
};

export const VIEWER_ACCOUNT: SmokeAccount = {
  email: "viewer@roamlog.test",
  password: "Roamlog-Verify-Aa1!",
  name: "Jonas Berg",
};

const SUPER_ADMIN_PASSWORD = "Roamlog-Smoke-Aa1!";

export function createSuperAdminAccount(runId: string): SmokeAccount {
  return {
    email: `e2e-smoke-${runId}-super@roamlog.test`,
    password: SUPER_ADMIN_PASSWORD,
    name: "E2E Smoke Super Admin",
  };
}

interface ProvisionedUser {
  created?: boolean;
  deleted?: boolean;
  id?: string;
  userId?: string;
  email: string;
  platformRole?: string;
  workspaceId?: string;
  role?: string;
}

function runProvisionScript(args: readonly string[]): ProvisionedUser {
  const quoteShellArg = (value: string): string =>
    process.platform === "win32"
      ? /[\s"]/u.test(value)
        ? `"${value.replaceAll('"', '""')}"`
        : value
      : `'${value.replaceAll("'", `'\\''`)}'`;
  const command = [
    "pnpm",
    "--filter",
    "@roamlog/api",
    "exec",
    "tsx",
    "../../e2e/support/provision-smoke-accounts.ts",
    ...args,
  ]
    .map(quoteShellArg)
    .join(" ");

  const output = execSync(command, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: SMOKE_DATABASE_URL },
    stdio: "pipe",
  });

  const line = output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("{") && entry.endsWith("}"))
    .at(-1);
  if (!line) {
    throw new Error(`Provisioning script returned no JSON. Output:\n${output}`);
  }
  return JSON.parse(line) as ProvisionedUser;
}

/** Creates (or re-creates) the run-unique `super_admin` account. */
export function provisionSuperAdmin(account: SmokeAccount): void {
  const result = runProvisionScript([
    "--action=create-super",
    `--email=${account.email}`,
    `--password=${account.password}`,
  ]);
  expect(result.created, `super_admin ${account.email} must be created`).toBe(true);
  expect(result.platformRole).toBe("super_admin");
}

/** Creates a run-scoped member in an existing seeded workspace. */
export function provisionWorkspaceMember(
  account: SmokeAccount,
  workspaceSlug: string,
  role: "owner" | "admin" | "editor" | "viewer" = "viewer",
): { userId: string; workspaceId: string; role: string } {
  const result = runProvisionScript([
    "--action=create-member",
    `--email=${account.email}`,
    `--password=${account.password}`,
    `--name=${account.name}`,
    `--workspace-slug=${workspaceSlug}`,
    `--role=${role}`,
  ]);
  expect(result.created, `workspace member ${account.email} must be created`).toBe(true);
  expect(result.role).toBe(role);
  expect(result.userId).toBeTruthy();
  expect(result.workspaceId).toBeTruthy();
  return {
    userId: result.userId as string,
    workspaceId: result.workspaceId as string,
    role: result.role as string,
  };
}

/** Best-effort delete; safe to call when provisioning already failed. */
export function deleteSuperAdmin(email: string): void {
  runProvisionScript(["--action=delete", `--email=${email}`]);
}

/** Best-effort cleanup for any run-scoped `@roamlog.test` account. */
export function deleteSmokeAccount(email: string): void {
  runProvisionScript(["--action=delete", `--email=${email}`]);
}

interface SignInResponse {
  redirect?: boolean;
  twoFactorRedirect?: boolean;
  token?: string;
  user?: { id: string; email: string; name: string };
}

/**
 * Real Better Auth email/password sign-in. The cookie is stored in the given
 * request context (host-only `localhost`, so it is valid on both :3000 and
 * :3001 — cookies ignore ports).
 */
export async function signInViaApi(
  request: APIRequestContext,
  account: SmokeAccount,
  origin = WEB_URL,
  apiBaseUrl = API_URL,
): Promise<{ id: string; email: string; name: string }> {
  await waitForApi(request);
  const response = await request.post(`${apiBaseUrl}/v1/auth/sign-in/email`, {
    headers: { origin, "content-type": "application/json" },
    data: { email: account.email, password: account.password, rememberMe: true },
  });
  expect(response.status(), `sign-in for ${account.email}: ${await response.text()}`).toBe(200);

  const body = (await response.json()) as SignInResponse;
  if (body.twoFactorRedirect === true) {
    throw new Error(
      `${account.email} requires a TOTP challenge; this smoke suite provisions accounts without 2FA.`,
    );
  }
  expect(body.user?.email).toBe(account.email);
  return body.user as { id: string; email: string; name: string };
}

/**
 * Enrolls a freshly provisioned super_admin in Better Auth TOTP.
 *
 * This mirrors the real enrollment sequence used by the repository's live
 * fixture: sign in, enable the TOTP method, extract the secret from the
 * returned otpauth URI, then verify the current code so the factor is active.
 * The Playwright request context keeps the Better Auth cookies between calls.
 */
export async function enableSuperAdminTotp(account: SmokeAccount): Promise<string> {
  const context = await playwrightRequest.newContext({ baseURL: API_URL });
  try {
    await signInViaApi(context, account);

    const enable = await context.post("/v1/auth/two-factor/enable", {
      headers: { origin: WEB_URL },
      data: { password: account.password, method: "totp" },
    });
    const enableText = await enable.text();
    let enableBody: Record<string, unknown>;
    try {
      enableBody = enableText ? (JSON.parse(enableText) as Record<string, unknown>) : {};
    } catch {
      throw new Error(
        `TOTP enrollment for ${account.email} returned non-JSON HTTP ${enable.status()}: ${enableText}`,
      );
    }
    if (enable.status() !== 200 || typeof enableBody.totpURI !== "string") {
      throw new Error(
        `TOTP enrollment for ${account.email} failed with HTTP ${enable.status()}: ${enableText}`,
      );
    }

    const secret = new URL(enableBody.totpURI).searchParams.get("secret");
    if (!secret) {
      throw new Error(`Better Auth TOTP URI for ${account.email} did not include a secret.`);
    }

    let verify = await context.post("/v1/auth/two-factor/verify-totp", {
      headers: { origin: WEB_URL },
      data: { code: currentTotp(secret) },
    });
    if (verify.status() === 401) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      verify = await context.post("/v1/auth/two-factor/verify-totp", {
        headers: { origin: WEB_URL },
        data: { code: currentTotp(secret) },
      });
    }
    if (verify.status() !== 200) {
      throw new Error(
        `TOTP verification for ${account.email} failed with HTTP ${verify.status()}: ${await verify.text()}`,
      );
    }

    return secret;
  } finally {
    await context.dispose();
  }
}

/**
 * Waits for the API behind the web/app proxy to answer before a journey starts.
 * The shared local stack is restarted by other agents while they work; without
 * this the suite would report their restart window as a product failure.
 */
async function waitForApi(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await request.get(`${API_URL}/v1/health`, { timeout: 3_000 })).status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(200);
}

/** Logs in through the real web login page and lands inside the workspace. */
export async function loginOnWeb(page: Page, account: SmokeAccount): Promise<void> {
  await waitForApi(page.request);
  await page.goto(`${WEB_URL}/login`);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByLabel("邮箱").fill(account.email);
    await page.getByLabel("密码").fill(account.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();

    const landed = await page
      .waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) break;

    // A restarted dev API can answer the login POST with a non-JSON error page.
    // Retry that transient case, but fail loudly on a real authentication error.
    const transient = await page
      .getByText("Authentication response was not JSON.")
      .isVisible()
      .catch(() => false);
    if (!transient || attempt === 3) {
      throw new Error(`web login for ${account.email} did not reach /w/ (attempt ${attempt})`);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  // The sidebar renders the signed-in email even when a dashboard query is
  // temporarily failing. The display name is user-editable, so use the unique
  // account email as the stable "login really landed" marker.
  await expect(page.getByText(account.email, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Logs in through the real admin login page.
 *
 * When Better Auth asks for the second factor, the caller must supply the
 * enrolled TOTP secret. A challenge without a secret is an explicit failure:
 * silently returning would turn a real authentication regression into a skip.
 */
export async function loginOnAdmin(
  page: Page,
  account: SmokeAccount,
  totpSecret?: string,
): Promise<void> {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel("管理员邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登录" }).click();

  const twoFactor = page.getByRole("heading", { name: "两步验证" });
  const consoleHeading = page.getByRole("link", { name: /平台|总览/ });

  await expect
    .poll(
      async () => {
        if (await twoFactor.isVisible().catch(() => false)) return "two-factor";
        if (new URL(page.url()).pathname.startsWith("/admin")) return "console";
        if (await consoleHeading.isVisible().catch(() => false)) return "console";
        return "pending";
      },
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    )
    .not.toBe("pending");

  if (await twoFactor.isVisible().catch(() => false)) {
    if (!totpSecret) {
      throw new Error(
        `Admin login for ${account.email} requires a TOTP challenge, but no totpSecret was provided.`,
      );
    }
    await page.getByLabel("6 位验证码").fill(currentTotp(totpSecret));
    await page.getByRole("button", { name: "验证并进入控制台" }).click();
  }

  await page.waitForURL("**/admin**", { timeout: 30_000 });
}

/** Workspace lookup shared by the web journeys (id is not hardcoded). */
export async function findWorkspace(
  request: APIRequestContext,
  slug: string = WORKSPACE_SLUG,
): Promise<{ id: string; slug: string; name: string }> {
  const response = await request.get(`${API_URL}/v1/me/workspaces`);
  expect(response.status(), await response.text()).toBe(200);
  const workspaces = (await response.json()) as Array<{ id: string; slug: string; name: string }>;
  const workspace = workspaces.find((entry) => entry.slug === slug);
  expect(workspace, `workspace ${slug} must be visible to the signed-in account`).toBeTruthy();
  return workspace as { id: string; slug: string; name: string };
}

/**
 * Creates a session against an auxiliary API process and returns it as a raw
 * Cookie header. Used when the shared `:4000` process is being restarted by a
 * parallel agent: the browser still logs in normally, but the journeys route
 * their `/v1` calls to the stable auxiliary process that shares the database.
 */
export async function auxiliaryApiSession(
  apiBaseUrl: string,
  account: SmokeAccount,
): Promise<string> {
  const context = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  try {
    await signInViaApi(context, account, WEB_URL, apiBaseUrl);
    return (await context.cookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  } finally {
    await context.dispose();
  }
}

/**
 * Forwards every same-origin `/v1/**` browser call (except auth, which has
 * already completed) to the auxiliary API with its session cookie. Server-side
 * rendering still uses the default API; only client data calls are redirected.
 */
export async function routeBrowserApi(
  page: Page,
  apiBaseUrl: string,
  cookieHeader: string,
): Promise<void> {
  await page.route("**/v1/**", async (route) => {
    const original = new URL(route.request().url());
    if (original.pathname.startsWith("/v1/auth/")) {
      await route.continue();
      return;
    }
    const target = new URL(`${original.pathname}${original.search}`, apiBaseUrl);
    const response = await route.fetch({
      url: target.toString(),
      headers: { ...route.request().headers(), cookie: cookieHeader },
      timeout: 90_000,
    });
    await route.fulfill({ response });
  });
}
