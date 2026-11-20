import { describe, expect, it } from "vitest";

import { queryVariants, toTraditional } from "../ranking/query-variants.js";

/**
 * `opencc-js@1.4.2` fixtures from `.audit/places-routing-spec.md` §4.5:
 * `东京 -> 東京`, `京都 -> 京都`, `建国路87号 -> 建國路87號`.
 */
describe("query-variants (opencc-js adapter)", () => {
  it("converts Simplified to Traditional with the documented s2t config", () => {
    expect(toTraditional("东京")).toBe("東京");
    expect(toTraditional("京都")).toBe("京都");
    expect(toTraditional("建国路87号")).toBe("建國路87號");
  });

  it("returns both variants for a Han query on a global provider", () => {
    expect(queryVariants("photon", "东京")).toEqual(["东京", "東京"]);
    expect(queryVariants("geoapify", "建国路87号")).toEqual(["建国路87号", "建國路87號"]);
  });

  it("de-duplicates when Simplified and Traditional are identical", () => {
    expect(queryVariants("photon", "京都")).toEqual(["京都"]);
  });

  it("never rewrites the Tencent query", () => {
    expect(queryVariants("tencent", "东京")).toEqual(["东京"]);
  });

  it("passes non-Han queries through untouched", () => {
    expect(queryVariants("photon", "Paris")).toEqual(["Paris"]);
    expect(queryVariants("geoapify", "5th Avenue")).toEqual(["5th Avenue"]);
  });
});
