import { Converter } from "opencc-js";

import type { PeliasSource } from "./pelias-document.js";

/**
 * Simplified → Traditional query variants.
 *
 * Upstream: `opencc-js@3261dce0f02a54d7a6bfc31bef77269e2bf16551`
 * (`src/data-config.js:30-31` defines `s2t: { from: 'cn', to: 't',
 * segmentation: 'STPhrases', chain: [['STPhrases','STCharacters']] }`;
 * `README.md:57-69` shows `Converter({ from: 'cn', to: 'tw' })`).
 *
 * 【适配层，本仓库原创】Pelias itself never converts scripts: its multilingual
 * names come from importers (`pelias/documentation/roadmap.md:36-51` says
 * expanded input-language support is still a roadmap item). Roamlog queries
 * live provider APIs that index Han names in their own script, so the adapter
 * produces a Traditional variant before querying global providers. This is
 * i18n data coverage, not a ranking rule (spec §5.3).
 *
 * The converter is created once because OpenCC loads a phrase dictionary.
 */
const converter = Converter({ from: "cn", to: "tw" });

/** Han script (`\p{Script=Han}` covers CJK ideographs outside the BMP). */
const HAN_SCRIPT = /\p{Script=Han}/u;

export function toTraditional(query: string): string {
  return converter(query);
}

/**
 * `variants(provider, q)` from spec §5.3:
 * - Tencent keeps the original query (mainland data is Simplified).
 * - Every global provider gets `[q, s2t(q)]` for a Han query, de-duplicated.
 * - Non-Han queries are passed through untouched.
 */
export function queryVariants(provider: PeliasSource, query: string): readonly string[] {
  if (provider === "tencent") {
    return [query];
  }
  if (!HAN_SCRIPT.test(query)) {
    return [query];
  }
  const traditional = toTraditional(query);
  return traditional === query ? [query] : [query, traditional];
}

export { HAN_SCRIPT };
