/**
 * measure-dictation.test.ts — counts split at the time given, whole words only,
 * matcher events attributed to the term they applied.
 */
import { test, expect } from "bun:test";
import { measure, parseLog, formatTable } from "../scripts/measure-dictation.ts";

const line = (timestamp: string, message: string) => JSON.stringify({ timestamp, fields: { message } });
const applied = (timestamp: string, to: string) => JSON.stringify({ timestamp, fields: { message: "vocab_match_applied", to } });

const GLOSSARY = [{ term: "Iris", mistranscriptions: ["Irish"] }];

test("parseLog skips lines that are not JSON", () => {
  const events = parseLog(`${line("2026-10-29T10:00:00Z", "a")}\nnot json\n`);
  expect(events).toHaveLength(1);
});

test("counts wrong and right forms on each side of the split, whole words only", () => {
  const text = [
    line("2026-10-29T09:00:00Z", "Apple STT result: Irish is here and Irish again"),
    line("2026-10-29T10:00:00Z", "Apple STT result: Iris is here and Irishman is not a match"),
    line("2026-10-29T11:00:00Z", "Apple STT result: Iris and Irish"),
    applied("2026-10-29T11:00:01Z", "Iris"),
    applied("2026-10-29T08:00:00Z", "Iris"),
  ].join("\n");
  const [row] = measure(GLOSSARY, parseLog(text), "2026-10-29T09:37:00Z");
  // Before the split: two "Irish" lines, no right form, one applied correction.
  expect(row.before).toEqual({ wrong: 2, right: 0, applied: 1 });
  // After: "Irishman" is not a whole-word match; one "Irish" and two "Iris" lines; one applied.
  expect(row.after).toEqual({ wrong: 1, right: 2, applied: 1 });
});

test("a term with no raw lines reports n/a, not 0%", () => {
  const rows = measure(GLOSSARY, [], "2026-10-29T09:37:00Z");
  expect(formatTable(rows)).toContain("n/a");
});

test("the table has one row per wrong form", () => {
  const rows = measure([{ term: "Qwen", mistranscriptions: ["Quin", "Quen"] }], [], "2026-10-29T09:37:00Z");
  expect(rows.map((r) => r.wrong)).toEqual(["Quin", "Quen"]);
});
