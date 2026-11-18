import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** Journey 7 — Tab traversal of the create form and the visible focus ring. */

const WORKSPACE = "roamlog-crew";
const NEW_TRIP = `/w/${WORKSPACE}/trips/new`;
const SHOTS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/shots");
const LOGS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/logs");

interface FocusStep {
  step: number;
  tag: string;
  id: string;
  role: string;
  name: string;
  focusVisible: boolean;
  outline: string;
  boxShadow: string;
  hasRing: boolean;
  skipped: boolean;
}

test("keyboard: every Tab stop on the create page shows a focus ring", async ({ page }) => {
  await page.goto(NEW_TRIP);
  await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({ timeout: 30_000 });

  const steps: FocusStep[] = [];
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate((): FocusStep | null => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      const style = getComputedStyle(element);
      const outlineWidth = style.outlineWidth;
      const outlineStyle = style.outlineStyle;
      const box = element.getBoundingClientRect();
      // The Next.js dev overlay lives in a custom element and is not product UI.
      const skipped =
        element.tagName === "NEXTJS-PORTAL" ||
        element.tagName === "BODY" ||
        element.tagName === "HTML" ||
        (box.width === 0 && box.height === 0);
      return {
        step: 0,
        tag: element.tagName,
        id: element.id,
        role: element.getAttribute("role") ?? "",
        name:
          element.getAttribute("aria-label") ??
          (element as HTMLInputElement).placeholder ??
          (element.textContent ?? "").trim().slice(0, 24),
        focusVisible: element.matches(":focus-visible"),
        outline: `${outlineStyle} ${outlineWidth}`,
        boxShadow: style.boxShadow,
        hasRing:
          style.boxShadow !== "none" || (outlineStyle !== "none" && outlineWidth !== "0px"),
        skipped,
      };
    });
    if (!info) continue;
    steps.push({ ...info, step });
  }

  fs.mkdirSync(LOGS, { recursive: true });
  fs.writeFileSync(path.join(LOGS, "focus-order.json"), JSON.stringify(steps, null, 2));
  await page.screenshot({
    path: path.join(SHOTS, "keyboard-focus-ring.png"),
    animations: "disabled",
  });

  const checked = steps.filter((step) => !step.skipped);
  const withoutRing = checked.filter((step) => !step.focusVisible || !step.hasRing);
  expect(
    withoutRing,
    `Tab stops without a visible focus ring: ${JSON.stringify(withoutRing, null, 2)}`,
  ).toEqual([]);

  // The traversal must actually cover the real controls, not just the shell.
  const ids = checked.map((step) => step.id);
  for (const required of ["trip-title", "trip-start-date", "trip-end-date", "trip-origin"]) {
    expect(ids, `Tab order should include #${required}`).toContain(required);
  }
});