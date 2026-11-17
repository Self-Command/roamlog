import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const WORKSPACE_PATH = "/w/roamlog-crew";
export const KYOTO_TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000011";
export const KYOTO_TRIP_PATH = `${WORKSPACE_PATH}/trips/${KYOTO_TRIP_ID}`;
export const SHARE_PATH = "/share/demo-public";
export const ADMIN_ROLE_STORAGE_KEY = "roamlog.admin.role-preview.v1";

type Heading = string | RegExp;

export interface RouteAudit {
  name: string;
  path: string;
  heading: Heading;
  titleLimit?: "trip" | "journal";
  requireH1?: boolean;
}

export const WEB_ROUTES: RouteAudit[] = [
  {
    name: "dashboard",
    path: WORKSPACE_PATH,
    heading: "旅行总览",
  },
  {
    name: "trips",
    path: `${WORKSPACE_PATH}/trips`,
    heading: "旅行库",
  },
  {
    name: "journal",
    path: `${WORKSPACE_PATH}/journal`,
    heading: "全部日志",
    titleLimit: "journal",
  },
  {
    name: "trip-detail",
    path: KYOTO_TRIP_PATH,
    heading: "京都红叶慢行",
    titleLimit: "trip",
  },
  {
    name: "atlas-map",
    path: `${WORKSPACE_PATH}/map`,
    heading: "世界足迹",
  },
  {
    name: "trip-map",
    path: `${KYOTO_TRIP_PATH}/map`,
    heading: "路线与停靠点",
    requireH1: false,
  },
  {
    name: "public-share",
    path: SHARE_PATH,
    heading: /.+/,
  },
  {
    name: "workspace-settings",
    path: `${WORKSPACE_PATH}/settings`,
    heading: "设置",
  },
  {
    name: "security-settings",
    path: "/settings/security",
    heading: "账号安全",
  },
];

export const ADMIN_ROUTES: RouteAudit[] = [
  {
    name: "dashboard",
    path: "/admin",
    heading: "平台总览",
  },
  {
    name: "users",
    path: "/admin/users",
    heading: "用户",
  },
  {
    name: "queues",
    path: "/admin/queues",
    heading: "队列",
  },
  {
    name: "flags",
    path: "/admin/flags",
    heading: "功能开关",
  },
  {
    name: "system",
    path: "/admin/system",
    heading: "系统健康",
  },
];

export const VISUAL_WIDTHS = [1440, 1024, 390] as const;
export const VISUAL_HEIGHTS: Record<(typeof VISUAL_WIDTHS)[number], number> = {
  1440: 1000,
  1024: 900,
  390: 844,
};

export function slugify(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function setAdminRole(page: Page, role = "super_admin"): Promise<void> {
  await page.addInitScript(
    ([storageKey, storedRole]) => {
      window.localStorage.setItem(storageKey, storedRole);
    },
    [ADMIN_ROLE_STORAGE_KEY, role],
  );
}

export async function gotoAndWait(
  page: Page,
  route: Pick<RouteAudit, "path" | "heading">,
): Promise<void> {
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  const heading = page.getByRole("heading", {
    name: route.heading,
    exact: typeof route.heading === "string",
  });
  await expect(heading.first()).toBeVisible({ timeout: 30_000 });
  await page
    .waitForFunction(() => document.fonts.status === "loaded", undefined, {
      timeout: 15_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(350);
}

export async function assertNoSeriousAxeViolations(
  page: Page,
  label: string,
  testInfo: TestInfo,
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const counts = results.violations.reduce<Record<string, number>>((accumulator, violation) => {
    const impact = violation.impact ?? "unknown";
    accumulator[impact] = (accumulator[impact] ?? 0) + 1;
    return accumulator;
  }, {});
  const severe = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  await testInfo.attach(`${slugify(label)}-axe.json`, {
    body: Buffer.from(
      JSON.stringify(
        {
          url: page.url(),
          counts,
          violations: results.violations,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });

  const details = severe
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => {
          const target = node.target.join(", ");
          return `  - ${target}: ${node.failureSummary ?? node.html}`;
        })
        .join("\n");
      return `[${violation.impact}] ${violation.id}: ${violation.help} (${violation.helpUrl})\n${nodes}`;
    })
    .join("\n\n");

  expect(
    severe,
    severe.length
      ? `${label}: axe found ${severe.length} serious/critical violation(s)\n${details}`
      : `${label}: axe serious/critical violations`,
  ).toHaveLength(0);
}

interface VisualAuditOptions {
  titleLimit?: "trip" | "journal";
  requireH1?: boolean;
}

export async function assertVisualRules(
  page: Page,
  label: string,
  options: VisualAuditOptions = {},
): Promise<void> {
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(overflow.documentWidth, `${label}: document horizontal overflow`).toBeLessThanOrEqual(
    overflow.viewportWidth + 1,
  );
  expect(overflow.bodyWidth, `${label}: body horizontal overflow`).toBeLessThanOrEqual(
    overflow.viewportWidth + 1,
  );

  const headingSizes = await page.locator("h1").evaluateAll((headings) =>
    headings
      .filter((heading) => {
        const style = window.getComputedStyle(heading);
        const rect = heading.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((heading) => ({
        fontSize: Number.parseFloat(window.getComputedStyle(heading).fontSize),
        text: heading.textContent?.trim().slice(0, 80) ?? "",
      })),
  );
  if (options.requireH1 !== false) {
    expect(headingSizes.length, `${label}: visible h1`).toBeGreaterThan(0);
  }
  for (const heading of headingSizes) {
    expect(heading.fontSize, `${label}: h1 "${heading.text}" must be <= 56px`).toBeLessThanOrEqual(
      56.5,
    );
  }

  if (options.titleLimit === "trip") {
    for (const heading of headingSizes) {
      expect(
        heading.fontSize,
        `${label}: trip h1 "${heading.text}" must be <= 48px`,
      ).toBeLessThanOrEqual(48.5);
    }
  }

  if (options.titleLimit === "journal") {
    const journalSizes = await page.locator("h3.font-serif").evaluateAll((headings) =>
      headings
        .filter((heading) => {
          const rect = heading.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((heading) => ({
          fontSize: Number.parseFloat(window.getComputedStyle(heading).fontSize),
          text: heading.textContent?.trim().slice(0, 80) ?? "",
        })),
    );
    for (const heading of journalSizes) {
      expect(
        heading.fontSize,
        `${label}: journal title "${heading.text}" must be <= 36px`,
      ).toBeLessThanOrEqual(36.5);
    }
  }

  const primaries = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, a"));
    return candidates
      .filter((element) => {
        if (element.getAttribute("aria-hidden") === "true") return false;
        if (element.closest("[aria-hidden='true']")) return false;
        if (element.matches("a[href^='#']")) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const visibleInViewport =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.top < window.innerHeight;
        const classes = new Set(element.classList);
        return visibleInViewport && classes.has("bg-ink");
      })
      .map((element) => ({
        label:
          element.getAttribute("aria-label") ??
          element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ??
          element.tagName,
      }));
  });

  expect(
    primaries.length,
    `${label}: white primary controls in first viewport (${primaries
      .map((primary) => primary.label)
      .join(" | ")})`,
  ).toBeLessThanOrEqual(1);
}

export async function captureVisualScreenshot(
  page: Page,
  app: "web" | "admin",
  routeName: string,
  width: number,
): Promise<string> {
  const directory = path.join(process.cwd(), "e2e", "screenshots", "w5-a11y-perf", app);
  mkdirSync(directory, { recursive: true });
  const outputPath = path.join(directory, `${slugify(routeName)}-${width}.png`);
  await page.screenshot({
    path: outputPath,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  return outputPath;
}

export async function expectFocusInsideDialog(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const dialog = document.querySelector("[role='dialog']");
          return Boolean(dialog && dialog.contains(document.activeElement));
        }),
      { message: "focus should enter the open dialog" },
    )
    .toBe(true);
}

export async function expectFocusRemainsInsideDialog(page: Page): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog']");
      return Boolean(dialog && dialog.contains(document.activeElement));
    });
    expect(inside, `focus escaped the dialog after ${index + 1} Tab press(es)`).toBe(true);
  }
}

export async function expectKeyboardTabOrder(page: Page, steps = 12): Promise<void> {
  await page.keyboard.press("Tab");
  let previousIndex = -1;
  let visited = 0;
  let attempts = 0;

  while (visited < steps) {
    attempts += 1;
    expect(attempts, `could not collect ${steps} product Tab stops`).toBeLessThanOrEqual(steps + 5);
    const focus = await page.evaluate(() => {
      const selector = [
        "a[href]",
        "button:not([disabled])",
        "summary",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",");
      const order = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0 &&
            !element.closest("[inert]")
          );
        },
      );
      const active = document.activeElement as HTMLElement | null;
      const style = active ? window.getComputedStyle(active) : null;
      const activeRect = active?.getBoundingClientRect();
      const visibleSkipLink =
        active instanceof HTMLAnchorElement &&
        active.hash.length > 1 &&
        Boolean(
          activeRect &&
          activeRect.width > 0 &&
          activeRect.height > 0 &&
          activeRect.top >= 0 &&
          activeRect.bottom <= window.innerHeight,
        );
      return {
        isNextDevPortal: active?.tagName === "NEXTJS-PORTAL",
        index: active ? order.indexOf(active) : -1,
        label:
          active?.getAttribute("aria-label") ??
          active?.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ??
          active?.tagName ??
          "none",
        focusVisible: active?.matches(":focus-visible") ?? false,
        hasVisibleIndicator: style
          ? (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) ||
            style.boxShadow !== "none" ||
            visibleSkipLink
          : false,
      };
    });

    if (focus.isNextDevPortal) {
      await page.keyboard.press("Tab");
      continue;
    }

    visited += 1;
    expect(focus.index, `Tab step ${visited} did not land on a focusable element`).toBeGreaterThan(
      -1,
    );
    expect(
      focus.index,
      `Tab order moved backwards at step ${visited} on "${focus.label}"`,
    ).toBeGreaterThan(previousIndex);
    expect(focus.focusVisible, `"${focus.label}" did not match :focus-visible`).toBe(true);
    expect(
      focus.hasVisibleIndicator,
      `"${focus.label}" has no visible outline or ring while focus-visible`,
    ).toBe(true);
    previousIndex = focus.index;
    if (visited < steps) await page.keyboard.press("Tab");
  }
}
