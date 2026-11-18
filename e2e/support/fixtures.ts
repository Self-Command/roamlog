import { test as base, expect, type ConsoleMessage, type Page } from "@playwright/test";

interface ConsoleIssue {
  type: "error" | "warning" | "pageerror";
  text: string;
  location?: string;
}

const knownDevWarnings = [/Cross origin request detected/i];

function isKnownDevWarning(message: ConsoleMessage): boolean {
  const text = message.text();
  return knownDevWarnings.some((pattern) => pattern.test(text));
}

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const issues: ConsoleIssue[] = [];
      const ignored: ConsoleIssue[] = [];
      const seenIssues = new Set<string>();
      const seenIgnored = new Set<string>();

      page.on("console", (message) => {
        // Read the type once so TypeScript narrows it (a repeated `message.type()`
        // call is not narrowed and widened ConsoleIssue.type to every level).
        const type = message.type();
        if (type !== "warning" && type !== "error") return;

        const issue: ConsoleIssue = {
          type,
          text: message.text(),
          location: message.location().url,
        };

        if (type === "warning" && isKnownDevWarning(message)) {
          const key = `${issue.type}:${issue.text}`;
          if (!seenIgnored.has(key)) {
            seenIgnored.add(key);
            ignored.push(issue);
          }
          return;
        }

        const key = `${issue.type}:${issue.text}`;
        if (!seenIssues.has(key)) {
          seenIssues.add(key);
          issues.push(issue);
        }
      });

      page.on("pageerror", (error) => {
        issues.push({
          type: "pageerror",
          text: error.stack ?? error.message,
        });
      });

      await use();

      if (ignored.length > 0) {
        await testInfo.attach("ignored-console-warnings.json", {
          body: Buffer.from(JSON.stringify(ignored, null, 2)),
          contentType: "application/json",
        });
      }

      if (issues.length > 0) {
        await testInfo.attach("console-issues.json", {
          body: Buffer.from(JSON.stringify(issues, null, 2)),
          contentType: "application/json",
        });
      }

      expect(
        issues,
        "Browser console errors/warnings and uncaught page errors must be empty",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
