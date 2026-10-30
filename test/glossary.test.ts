/**
 * glossary.test.ts — pure merge and corrections validation, no filesystem writes.
 */
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorrections, mergeGlossary } from "../scripts/glossary.ts";

const fileWith = (body: string) => {
  const f = join(mkdtempSync(join(tmpdir(), "do-gloss-")), "c.json");
  writeFileSync(f, body);
  return f;
};

test("loadCorrections accepts a valid array and trims, dedupes, defaults frequency", () => {
  const f = fileWith(JSON.stringify([{ term: " Iris ", mistranscriptions: [" Irish ", "Irish"] }]));
  expect(loadCorrections(f)).toEqual([{ term: "Iris", mistranscriptions: ["Irish"], frequency: 1 }]);
});

test("loadCorrections rejects a non-array, empty term, empty list, and self-mapping", () => {
  expect(() => loadCorrections(fileWith('{"term":"x"}'))).toThrow("expected a JSON array");
  expect(() => loadCorrections(fileWith('[{"term":"","mistranscriptions":["a"]}]'))).toThrow("term must be a non-empty string");
  expect(() => loadCorrections(fileWith('[{"term":"a","mistranscriptions":[]}]'))).toThrow("non-empty array");
  expect(() => loadCorrections(fileWith('[{"term":"a","mistranscriptions":["a"]}]'))).toThrow("cannot be its own mistranscription");
});

test("mergeGlossary appends unknown terms and unions mistranscriptions of known ones", () => {
  const entries = [{ term: "Iris", mistranscriptions: ["Irish"], frequency: 9 }, { term: "winnow", mistranscriptions: ["Vino"] }];
  const r = mergeGlossary(entries, [
    { term: "Iris", mistranscriptions: ["Irish", "Iris's"], frequency: 53 },
    { term: "Qwen", mistranscriptions: ["Quin"], frequency: 1 },
  ]);
  expect(r.added).toEqual(["Qwen"]);
  expect(r.updated).toEqual(["Iris"]);
  expect(r.entries[0]).toMatchObject({ term: "Iris", mistranscriptions: ["Irish", "Iris's"], frequency: 9 });
  expect(r.entries[2]).toMatchObject({ term: "Qwen", mistranscriptions: ["Quin"], frequency: 1, weight: 1, provenance: "dictation-optimizer" });
  // The input is not mutated.
  expect(entries[0].mistranscriptions).toEqual(["Irish"]);
});

test("mergeGlossary with nothing new reports no change", () => {
  const r = mergeGlossary([{ term: "Iris", mistranscriptions: ["Irish"] }], [{ term: "Iris", mistranscriptions: ["Irish"], frequency: 1 }]);
  expect(r.added).toEqual([]);
  expect(r.updated).toEqual([]);
});
