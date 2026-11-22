import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const rawColor = /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/gi;

describe("media and authentication appearance tokens", () => {
  it("uses semantic tokens for media chrome and upload states", () => {
    for (const path of [
      "components/media/photo-lightbox.css",
      "components/media/photo-uploader.css",
    ]) {
      expect(read(path), path).not.toMatch(rawColor);
    }

    const adminMedia = read("../admin/components/media/media-view.tsx");
    expect(adminMedia).toContain("from-surface-2 via-surface-deep to-canvas");
    expect(adminMedia).toContain("from-canvas/70");
    expect(adminMedia).not.toMatch(rawColor);
  });

  it("uses semantic tokens for the notification bell", () => {
    const source = read("components/app-shell/notification-bell.tsx");
    expect(source).toContain("hover:bg-surface-1");
    expect(source).toContain("text-canvas");
    expect(source).not.toMatch(rawColor);
  });

  it("keeps only the documented QR black/white exceptions", () => {
    const adminQr = read("../admin/components/login/two-factor-enrollment.tsx");
    const webQr = read("components/auth/totp-qr.tsx");

    for (const source of [adminQr, webQr]) {
      expect(source).toContain("QR modules must stay pure black on white");
      expect(source.match(rawColor) ?? []).toHaveLength(2);
    }
  });
});
