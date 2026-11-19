/**
 * Shared plumbing for the deployment smoke suite: run ids, failure evidence
 * and the screenshot sink required by the task (`/.audit/evidence/e2e-smoke`).
 */
import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "@playwright/test";

export const EVIDENCE_DIR = path.join(process.cwd(), ".audit", "evidence", "e2e-smoke");

export type SmokeTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

export function uniqueRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/\s+/gu, "-")
    .slice(0, 120);
}

/**
 * Registers an `afterEach` that writes a full-page screenshot for every failed
 * test into `.audit/evidence/e2e-smoke/`. Playwright's own `only-on-failure`
 * screenshots go to `test-results/`; this is the durable evidence location
 * the release checklist reads.
 */
export function registerFailureEvidence(test: SmokeTest): void {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stem = safeName(`${testInfo.project.name}-${testInfo.titlePath.slice(-1)[0] ?? "test"}`);
    const target = path.join(EVIDENCE_DIR, `${stem}-${uniqueRunId()}.png`);

    await page
      .screenshot({ path: target, fullPage: true, animations: "disabled" })
      .catch(() => undefined);

    const summary = {
      title: testInfo.title,
      project: testInfo.project.name,
      status: testInfo.status,
      errors: testInfo.errors.map((error) => error.message ?? error.value ?? "unknown"),
      screenshot: path.relative(process.cwd(), target).split(path.sep).join("/"),
    };
    writeFileSync(
      path.join(EVIDENCE_DIR, `${stem}-${uniqueRunId()}.json`),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  });
}