import { expect, type Page } from "@playwright/test";

export interface ConsoleError {
  source: "console" | "pageerror";
  text: string;
  url: string;
}

export function collectConsoleErrors(page: Page): ConsoleError[] {
  const errors: ConsoleError[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    errors.push({
      source: "console",
      text: message.text(),
      url: message.location().url,
    });
  });
  page.on("pageerror", (error) => {
    errors.push({
      source: "pageerror",
      text: error.message,
      url: page.url(),
    });
  });

  return errors;
}

export function expectNoUnexpectedConsoleErrors(
  errors: readonly ConsoleError[],
  options: {
    allowShareHttpErrors?: boolean;
    allowAuthSessionHttpErrors?: boolean;
  } = {},
): void {
  const unexpected = errors.filter((error) => {
    if (error.source !== "console" || !/Failed to load resource/i.test(error.text)) {
      return true;
    }
    if (options.allowShareHttpErrors && error.url.includes("/v1/public/trips/")) {
      return false;
    }
    if (options.allowAuthSessionHttpErrors && error.url.includes("/v1/auth/get-session")) {
      return false;
    }
    return true;
  });
  expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
}
