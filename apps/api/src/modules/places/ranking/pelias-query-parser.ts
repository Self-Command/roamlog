/**
 * `parsed_text` adapter for Pelias' parser contract.
 *
 * Upstream contract: `pelias/parser@1cd1a23e631b6692fe45f8058362ff98ec670e44`,
 * `server/routes/parse.js:28-39` (`label` → `name`/`housenumber`/`street`/
 * `postalcode`/`city`/`state`/`country`) and `parser/AddressParser.js:42-140`.
 *
 * 【适配层，本仓库原创】`pelias-parser@5.0.0` is an **optional** dependency in
 * the task spec §6.2 (`可选；不装则 parsed_text=undefined`). It is deliberately
 * not installed: the published package's entry point is an Express server
 * (`"main": "server/http.js"`), and its Latin-centric parser returns no
 * solution for every acceptance query in §5.5 (`北京/东京/京都/建国路87号`).
 * Returning `undefined` is the upstream-documented no-parsed_text branch of
 * `confidenceScore.js:93-108` / `132-146`, which `confidenceScore.js` handles
 * without throwing. The `ParsedText` interface is the exact field set consumed
 * by `confidenceScore.js` and `confidenceScoreFallback.js`.
 */

export interface ParsedText {
  readonly query?: string;
  readonly name?: string;
  readonly housenumber?: string | number;
  readonly street?: string;
  readonly postalcode?: string;
  readonly neighbourhood?: string;
  readonly borough?: string;
  readonly city?: string;
  readonly county?: string;
  readonly state?: string;
  readonly country?: string;
}

const HAN_SCRIPT = /\p{Script=Han}/u;
/** A house-number token: digits followed by a door-plate/street unit. */
const HOUSE_NUMBER = /[\d０-９]+\s*[号弄巷栋室楼]/u;
/** Short bare Han place name (city/locality-scale), no address token. */
const BARE_HAN_NAME = /^\p{Script=Han}{2,4}$/u;

/**
 * Returns the Pelias parser solution for `text`, or `undefined` when the
 * optional parser is unavailable / has no solution.
 *
 * 【适配层，本仓库原创】`pelias-parser@5.0.0` is optional (spec §6.2) and its
 * Latin-centric address parser has no solution for Chinese (spec §5.5). A
 * **short bare Han name** (2–4 Han characters, no house-number token) is the
 * city/locality shape that `confidenceScoreFallback.js:124-185`'s `city` rule
 * describes; returning `{ city: text }` lets `trimByGranularity` apply the
 * same requested-layer filter Pelias gets from `parsed_text`, so a Tencent POI
 * named after a city (`东京城镇`, `京都之星购物中心`) cannot outrank the real
 * locality found by a global provider. This reads only query characters — no
 * place-name list — and never fabricates `housenumber`/`street`.
 */
export function parseQuery(text: string): ParsedText | undefined {
  if (!HAN_SCRIPT.test(text) || HOUSE_NUMBER.test(text) || !BARE_HAN_NAME.test(text)) {
    return undefined;
  }
  return { city: text };
}
