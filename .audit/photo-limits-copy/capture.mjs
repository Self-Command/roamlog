import { chromium, request } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";
const OUT_DIR = path.resolve(".audit/photo-limits-copy");
const ACCOUNT = {
  email: "verify@roamlog.test",
  password: "Roamlog-Verify-Aa1!",
};

await mkdir(OUT_DIR, { recursive: true });

const api = await request.newContext({ baseURL: API_URL });
const signIn = await api.post("/v1/auth/sign-in/email", {
  headers: { origin: WEB_URL, "content-type": "application/json" },
  data: { ...ACCOUNT, rememberMe: true },
});
if (!signIn.ok()) {
  throw new Error(`sign-in failed: ${signIn.status()} ${await signIn.text()}`);
}

const workspacesResponse = await api.get("/v1/me/workspaces");
if (!workspacesResponse.ok()) {
  throw new Error(`workspaces failed: ${workspacesResponse.status()}`);
}
const workspaces = await workspacesResponse.json();
const workspace =
  workspaces.find((entry) => entry.slug === "roamlog-crew") ?? workspaces[0];
if (!workspace) throw new Error("no workspace available");

const tripsResponse = await api.get(`/v1/workspaces/${workspace.id}/trips?limit=50`);
if (!tripsResponse.ok()) {
  throw new Error(`trips failed: ${tripsResponse.status()}`);
}
const tripsBody = await tripsResponse.json();
const trip =
  (tripsBody.items ?? []).find((entry) => entry.title === "京都十一月") ??
  tripsBody.items?.[0];
if (!trip) throw new Error("no trip available");

const limitsResponse = await api.get(`/v1/workspaces/${workspace.id}/media/limits`);
const limits = limitsResponse.ok() ? await limitsResponse.json() : null;
const storageState = await api.storageState();
await api.dispose();

const browser = await chromium.launch();

async function capture(viewport, name) {
  const context = await browser.newContext({ viewport });
  await context.addCookies(storageState.cookies);
  const page = await context.newPage();
  const issues = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      issues.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  await page.goto(`${WEB_URL}/w/${workspace.slug}/trips/${trip.id}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByRole("tab", { name: "照片" }).click({ timeout: 30_000 });
  await page.getByTestId("photo-upload-open").click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog").filter({ hasText: "上传旅行照片" });
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  await dialog.getByTestId("photo-upload-dashboard").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.locator("nextjs-portal").evaluateAll((portals) => {
    for (const portal of portals) portal.style.display = "none";
  });
  const limitText = (await dialog.getByTestId("photo-upload-limit").innerText()).trim();
  const bodyText = await dialog.innerText();
  await page.screenshot({
    path: path.join(OUT_DIR, name),
    animations: "disabled",
  });
  console.log(JSON.stringify({ name, limitText, hasOldCopy: /服务端|签发|上传链接|HTTP/u.test(limitText), hasFooterOldCopy: /服务端|签发|上传链接|HTTP/u.test(bodyText), issues }));
  await context.close();
}

try {
  console.log(JSON.stringify({ workspace: workspace.slug, trip: trip.title, tripId: trip.id, limits }));
  await capture({ width: 1440, height: 1000 }, "desktop-1440-upload-panel.png");
  await capture({ width: 390, height: 844 }, "mobile-390-upload-panel.png");
} finally {
  await browser.close();
}
