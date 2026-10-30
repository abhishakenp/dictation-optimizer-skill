/**
 * candidates.test.ts — near-miss words of a glossary term, known forms excluded.
 */
import { test, expect } from "bun:test";
import { editDistance, findCandidates } from "../scripts/candidates.ts";

test("editDistance is case-insensitive Levenshtein", () => {
  expect(editDistance("Irish", "Iris")).toBe(1);
  expect(editDistance("Hetzner", "Hetzner")).toBe(0);
  expect(editDistance("kitten", "sitting")).toBe(3);
});

test("a near-miss is a candidate; a known wrong form and the term itself are not", () => {
  const glossary = [{ term: "Iris", mistranscriptions: ["Irish"] }];
  const raw = [{ at: "2026-10-30T05:00:00Z", text: "Irish and Iris and Irishman and Iris's" }];
  const found = findCandidates(glossary, raw, 1).map((c) => c.word);
  // "Iris's" is two edits from "Iris": a candidate only at distance 2.
  expect(found).toEqual([]);
  expect(findCandidates(glossary, raw, 2).map((c) => c.word)).toEqual(["Iris's"]);
});

test("distance 2 finds a wider near-miss", () => {
  const found = findCandidates([{ term: "Qwen" }], [{ at: "t", text: "Quin 3.6" }], 2);
  expect(found.map((c) => c.word)).toEqual(["Quin"]);
});
