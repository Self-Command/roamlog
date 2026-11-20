import { describe, expect, it } from "vitest";

import {
  checkAddress,
  checkForDealBreakers,
  checkName,
  computeConfidenceScore,
  computeStandardDeviation,
  propMatch,
} from "../ranking/pelias-confidence.js";

/**
 * Upstream fixture reuse.
 *
 * Every expected value below is copied from
 * `pelias/api@561e3e85f79b5388f88451cb1a49000764d29e35/test/unit/middleware/confidenceScore.js`
 * (`module.exports.tests.confidenceScore`), not invented. The pure function
 * signature replaces the Express middleware signature:
 *
 * `computeConfidenceScore({ text, parsedText, hit, scores })`.
 */
describe("pelias-confidence (upstream fixtures)", () => {
  it("no parsed_text with an exact name scores 0.6 (upstream 'res.results without parsed_text')", () => {
    const confidence = computeConfidenceScore({
      text: "test name1",
      hit: {
        _score: 10,
        name: { default: "test name1" },
        parent: { country: ["country1"], region: ["state1"], county: ["city1"] },
      },
      scores: [10],
    });
    expect(confidence).toBe(0.6);
  });

  it("undefined region fields score 0.28 (upstream 'undefined region fields')", () => {
    const confidence = computeConfidenceScore({
      text: "123 Main St, City, NM",
      parsedText: { housenumber: 123, street: "Main St", state: "NM" },
      hit: {
        _score: 10,
        name: { default: "test name1" },
        parent: { country: ["country1"], region: undefined, region_a: undefined, county: ["city1"] },
      },
      scores: [10],
    });
    expect(confidence).toBe(0.28);
  });

  it("missing parent scores 0.28 (upstream 'missing parent object')", () => {
    const confidence = computeConfidenceScore({
      text: "123 Main St, City, NM",
      parsedText: { housenumber: 123, street: "Main St", state: "NM" },
      hit: { _score: 10, name: { default: "test name1" } },
      scores: [10],
    });
    expect(confidence).toBe(0.28);
  });

  it("name aliases (array) score 0.28 (upstream 'works with name aliases')", () => {
    const confidence = computeConfidenceScore({
      text: "example",
      parsedText: { housenumber: 123, street: "example", state: "EG" },
      hit: { _score: 10, name: { default: ["test name1", "test name2"] } },
      scores: [10],
    });
    expect(confidence).toBe(0.28);
  });

  it("a state deal breaker short-circuits to 0.5 (confidenceScore.js:93-108)", () => {
    const hit = {
      _score: 10,
      name: { default: "test name1" },
      parent: { region_a: ["CA"] },
    };
    const parsedText = { housenumber: 123, street: "Main St", state: "NM" };
    expect(checkForDealBreakers(parsedText, hit)).toBe(true);
    expect(
      computeConfidenceScore({ text: "123 Main St, City, NM", parsedText, hit, scores: [10] }),
    ).toBe(0.5);
  });

  it("a postalcode deal breaker short-circuits to 0.5", () => {
    const hit = {
      _score: 10,
      name: { default: "test name1" },
      address_parts: { zip: "11111" },
    };
    const parsedText = { housenumber: 123, street: "Main St", postalcode: "22222" };
    expect(checkForDealBreakers(parsedText, hit)).toBe(true);
    expect(
      computeConfidenceScore({ text: "123 Main St", parsedText, hit, scores: [10] }),
    ).toBe(0.5);
  });

  it("relativeScores=false removes D/Z and changes checkCount to 3", () => {
    const confidence = computeConfidenceScore({
      text: "test name1",
      hit: { _score: 10, name: { default: "test name1" } },
      scores: [10],
      relativeScores: false,
    });
    expect(confidence).toBe(1);
  });

  it("parsed_text.name takes precedence over the raw text", () => {
    const confidence = computeConfidenceScore({
      text: "different text",
      parsedText: { name: "Bar" },
      hit: { _score: 10, name: { default: "bar" } },
      scores: [10],
    });
    expect(confidence).toBe(0.6);
  });

  it("checkName returns 0.7 for a non-matching name", () => {
    expect(checkName("北京", undefined, { _score: 1, name: { default: "北京市" } })).toBe(0.7);
  });

  it("propMatch follows the upstream branch table (confidenceScore.js:173-196)", () => {
    expect(propMatch(undefined, undefined, true)).toBe(0);
    expect(propMatch(undefined, undefined, false)).toBe(0);
    expect(propMatch("x", undefined, false)).toBe(0);
    expect(propMatch(undefined, "x", true)).toBe(1);
    expect(propMatch("X", "x", false)).toBe(1);
    expect(propMatch("x", "y", false)).toBe(0.7);
    // `null` is not `undefined`: the hit value exists, so the 50/50/0.7 branches apply.
    expect(propMatch("x", null, false)).toBe(0.7);
  });

  it("checkAddress averages five propMatch values", () => {
    expect(checkAddress(undefined, { _score: 1 })).toBe(1);
    expect(
      checkAddress(
        { housenumber: 123, street: "Main St" },
        { _score: 1, name: { default: "x" } },
      ),
    ).toBe(0.7);
  });

  it("computes population standard deviation like stats-lite", () => {
    expect(computeStandardDeviation([10])).toBe(0);
    expect(computeStandardDeviation([10, 20])).toBeCloseTo(5, 10);
    expect(computeStandardDeviation([10, 10, 10])).toBe(0);
  });
});
