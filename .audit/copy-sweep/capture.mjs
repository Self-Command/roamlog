/**
 * P0-CI-COPY runtime evidence.
 *
 * Runs against the real local stack (web 3000 + API 4000 + seeded workspace)
 * and captures the three dialogs called out by the task at desktop and mobile
 * widths. The trip is an empty workspace trip so the screenshots show real
 * empty states, not fixtures.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const EMAIL = process.env.VERIFY_EMAIL ?? "verify@roamlog.test";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "Roamlog-Verify-Aa1!";
const SLUG = "roamlog-crew";
const TRIP_ID = "01a1f838-d2eb-71cd-945b-493aeabd0e2d";
const OUT = ".audit/copy-sweep";

const DEVELOPER_COPY =
  /POST \/v1|PATCH \/v1|minor units|provider 留空|后续接入|接入写接口|写入 `|服务端|前端不拼接/;

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 200)}`));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`console: ${message.text().slice(0, 200)}`);
});

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function assertClean(label) {
  const body = await page.locator("body").innerText();
  const match = body.match(DEVELOPER_COPY);
  record(`${label}: no developer copy in body`, !match, match?.[0] ?? "");
  return body;
}

async function closeDialog() {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 10_000 });
}

await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByLabel("邮箱").fill(EMAIL);
await page.getByLabel("密码").fill(PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
record("real login leaves the login page", !page.url().includes("/login"), page.url());

await page.goto(`${WEB}/w/${SLUG}/trips/${TRIP_ID}`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.getByRole("tab", { name: "行程" }).waitFor({ timeout: 30_000 });
record(
  "authenticated trip page renders its tabs",
  await page.getByRole("tab", { name: "行程" }).isVisible(),
);
await page.waitForTimeout(1500);

for (const viewport of [
  { name: "1440", width: 1440, height: 1000 },
  { name: "390", width: 390, height: 844 },
]) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForTimeout(400);

  // Stops empty state + add dialog.
  await page.getByRole("tab", { name: "行程" }).click();
  await page.getByText("还没有行程节点").waitFor({ timeout: 20_000 });
  await shot(`stops-empty-${viewport.name}`);
  await assertClean(`stops empty ${viewport.name}`);
  await page.getByRole("button", { name: "添加第一个节点" }).click();
  const stopsDialog = page.getByRole("dialog");
  await stopsDialog.waitFor({ timeout: 10_000 });
  record(
    `stops dialog ${viewport.name}: product copy`,
    (await stopsDialog.innerText()).includes(
      "记录停留的城市、国家、日期与坐标，可补充备注；不确定坐标时可以留空。",
    ),
  );
  record(
    `stops dialog ${viewport.name}: no developer copy`,
    !DEVELOPER_COPY.test(await stopsDialog.innerText()),
  );
  await shot(`stops-dialog-${viewport.name}`);
  await closeDialog();

  // Expenses empty state + create dialog.
  await page.getByRole("tab", { name: "费用" }).click();
  await page.getByText("还没有记录支出").waitFor({ timeout: 20_000 });
  await shot(`expenses-empty-${viewport.name}`);
  await assertClean(`expenses empty ${viewport.name}`);
  await page.getByRole("button", { name: "记第一笔" }).click();
  const expensesDialog = page.getByRole("dialog");
  await expensesDialog.waitFor({ timeout: 10_000 });
  const expensesText = await expensesDialog.innerText();
  record(
    `expenses dialog ${viewport.name}: product copy`,
    expensesText.includes("记录这笔支出的日期、分类、金额与付款人；费用由选中的参与者平分。") &&
      expensesText.includes("按原币种输入金额") &&
      expensesText.includes("分摊参与者（平分）"),
  );
  record(`expenses dialog ${viewport.name}: no developer copy`, !DEVELOPER_COPY.test(expensesText));
  await shot(`expenses-dialog-${viewport.name}`);
  await closeDialog();

  // Share empty state + create dialog.
  await page.getByRole("tab", { name: "分享" }).click();
  await page.getByText("还没有分享链接").waitFor({ timeout: 20_000 });
  await shot(`share-empty-${viewport.name}`);
  await assertClean(`share empty ${viewport.name}`);
  await page.getByRole("button", { name: "创建第一个链接" }).click();
  const shareDialog = page.getByRole("dialog");
  await shareDialog.waitFor({ timeout: 10_000 });
  record(
    `share dialog ${viewport.name}: product copy`,
    (await shareDialog.innerText()).includes(
      "创建后，拿到链接的人可以阅读这趟旅行的公开内容；公开页只展示旅行、日志和照片，不展示评论、邮箱和内部备注。",
    ),
  );
  record(
    `share dialog ${viewport.name}: no developer copy`,
    !DEVELOPER_COPY.test(await shareDialog.innerText()),
  );
  await shot(`share-dialog-${viewport.name}`);
  await closeDialog();
}

await browser.close();

writeFileSync(
  `${OUT}/runtime.log`,
  `${results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`).join("\n")}\n\nconsole errors:\n${consoleErrors.join("\n") || "(none)"}\n`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (consoleErrors.length) {
  console.log("\nconsole errors:");
  for (const error of consoleErrors.slice(0, 10)) console.log(`  ${error}`);
}
if (failed.length) process.exit(1);
