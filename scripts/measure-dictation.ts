#!/usr/bin/env bun
/**
 * measure-dictation.ts — how often the recogniser gets each glossary term wrong,
 * before and after a split time, from the Always daemon log.
 *
 * Counts are over raw recogniser output ("Apple STT result:" lines) and over the
 * matcher's own events ("vocab_match_applied", one per applied correction). The
 * script only counts the glossary's known wrong and right forms; it does not
 * decide what anyone said.
 *
 * Usage:
 *   bun run scripts/measure-dictation.ts [--split 2026-10-29T09:37:00Z]
 *     [--glossary ~/.always/glossary.json] [--log-dir ~/Library/Logs/Always]
 *
 * Rates: wrong rate = wrong / (wrong + right), over raw lines in the period.
 * Caught = matcher corrections for the term / raw wrong lines (both per period).
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface GlossaryEntry {
  term: string;
  mistranscriptions?: string[];
}

export interface LogEvent {
  timestamp: string;
  fields?: { message?: string; to?: string; [key: string]: unknown };
}

export interface PeriodCount {
  wrong: number;
  right: number;
  applied: number;
}

export interface Row {
  term: string;
  wrong: string;
  before: PeriodCount;
  after: PeriodCount;
}

const RAW = "Apple STT result: ";

/** One JSON object per line; lines that do not parse are skipped. */
export const parseLog = (text: string): LogEvent[] =>
  text.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as LogEvent];
    } catch {
      return [];
    }
  });

/** Whole-word, case-insensitive match of a literal phrase. */
const wordRe = (phrase: string) => new RegExp(`(?<![\\p{L}\\p{N}])${phrase.trim().split(/\s+/).map(escapeRe).join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const countIn = (text: string, re: RegExp) => (text.match(re) ?? []).length;

/** Per-term, per-wrong-form counts on each side of the split. */
export const measure = (glossary: GlossaryEntry[], events: LogEvent[], splitIso: string): Row[] => {
  const split = Date.parse(splitIso);
  const raw = events
    .filter((e) => (e.fields?.message ?? "").startsWith(RAW))
    .map((e) => ({ at: Date.parse(e.timestamp), text: (e.fields!.message as string).slice(RAW.length) }));
  const applied = events.filter((e) => e.fields?.message === "vocab_match_applied").map((e) => ({ at: Date.parse(e.timestamp), to: e.fields?.to }));
  const side = (at: number): "before" | "after" => (at < split ? "before" : "after");
  const rows: Row[] = [];
  for (const entry of glossary) {
    for (const wrong of entry.mistranscriptions ?? []) {
      const wrongRe = wordRe(wrong);
      const rightRe = wordRe(entry.term);
      const row: Row = {
        term: entry.term,
        wrong,
        before: { wrong: 0, right: 0, applied: 0 },
        after: { wrong: 0, right: 0, applied: 0 },
      };
      for (const line of raw) {
        const s = side(line.at);
        row[s].wrong += countIn(line.text, wrongRe);
        row[s].right += countIn(line.text, rightRe);
      }
      for (const a of applied) if (a.to === entry.term) row[side(a.at)].applied++;
      rows.push(row);
    }
  }
  return rows;
};

const rate = (c: PeriodCount) => (c.wrong + c.right ? `${((100 * c.wrong) / (c.wrong + c.right)).toFixed(0)}%` : "n/a");

/** Terminal table: one row per wrong form. */
export const formatTable = (rows: Row[]): string => {
  const head = ["term", "wrong form", "wrong% before", "wrong% after", "raw wrong b/a", "matcher applied b/a"];
  const body = rows.map((r) => [
    r.term,
    r.wrong,
    rate(r.before),
    rate(r.after),
    `${r.before.wrong}/${r.after.wrong}`,
    `${r.before.applied}/${r.after.applied}`,
  ]);
  const all = [head, ...body];
  const widths = head.map((_, i) => Math.max(...all.map((row) => String(row[i]).length)));
  return all.map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ")).join("\n");
};

const argValue = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]!.replace(/^~/, homedir()) : fallback;
};

async function main() {
  const split = argValue("--split", "2026-10-29T09:37:00Z");
  const glossaryPath = argValue("--glossary", join(homedir(), ".always", "glossary.json"));
  const logDir = argValue("--log-dir", join(homedir(), "Library", "Logs", "Always"));
  const glossary = JSON.parse(readFileSync(glossaryPath, "utf-8")) as GlossaryEntry[];
  const logs = readdirSync(logDir).filter((f) => /^always\.\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  const events = logs.flatMap((f) => parseLog(readFileSync(join(logDir, f), "utf-8")));
  console.log(`split ${split} · ${logs.length} log files · ${events.length} events · glossary ${glossary.length} entries`);
  console.log(formatTable(measure(glossary, events, split)));
}

if (import.meta.main) main();
