import { describe, expect, it } from "vitest";

import { PublicShareTokenSchema } from "../../../../contracts/src/api/share-links.js";
import { DEMO_SHARE_TOKEN, demoShareTokenHash } from "../util.js";

describe("demo share token", () => {
  it("satisfies the public share link contract without a database", () => {
    expect(DEMO_SHARE_TOKEN.length).toBeGreaterThanOrEqual(32);
    expect(PublicShareTokenSchema.safeParse(DEMO_SHARE_TOKEN).success).toBe(true);
    expect(demoShareTokenHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
