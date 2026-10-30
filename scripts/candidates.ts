#!/usr/bin/env bun
/**
 * candidates.ts — reading aid: raw recogniser words that look like a glossary
 * term but are not one of its known forms. A human decides which are errors.
 *
 * It lists; it does not correct. A word is a candidate when its edit distance
 * to a glossary term is between 1 and --max-distance, and the word is neither
 * the term nor one of its listed wrong forms.
 *
 * Usage:
 *   bun run scripts/candidates.ts [--since 2026-10-29T09:37:00Z] [--max-distance 2]
 *     [--glossary ~/.always/glossary.json] [--log-dir ~/Library/Logs/Always]
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseLog, type GlossaryEntry } from "./measure-dictation.ts";

/** Levenshtein distance, case-insensitive. */
export const editDistance = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
};

export interface Candidate {
  word: string;
  term: string;
  distance: number;
  at: string;
  line: string;
}

/** Words of the raw lines (after `since`) that look like a term but are not one of its known forms. */
export const findCandidates = (glossary: GlossaryEntry[], rawLines: Array<{ at: string; text: string }>, maxDistance: number): Candidate[] => {
  const known = new Map<string, Set<string>>();
  for (const e of glossary) known.set(e.term.toLowerCase(), new Set([e.term.toLowerCase(), ...(e.mistranscriptions ?? []).map((m) => m.toLowerCase())]));
  const out: Candidate[] = [];
  for (const line of rawLines) {
    for (const word of line.text.match(/[\p{L}][\p{L}\p{N}'-]*/gu) ?? []) {
      const w = word.toLowerCase();
      // Short words match short terms by accident ("I" ~ "pi"); skip them.
      if (w.length < 3) continue;
      let best: { term: string; distance: number } | undefined;
      for (const e of glossary) {
        if (e.term.length < 4 || known.get(e.term.toLowerCase())!.has(w)) continue;
        const d = editDistance(w, e.term);
        if (d >= 1 && d <= maxDistance && (!best || d < best.distance)) best = { term: e.term, distance: d };
      }
      if (best) out.push({ word, term: best.term, distance: best.distance, at: line.at, line: line.text });
    }
  }
  return out;
};

const argValue = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]!.replace(/^~/, homedir()) : fallback;
};

async function main() {
  const since = Date.parse(argValue("--since", "2026-10-29T09:37:00Z"));
  const maxDistance = Number(argValue("--max-distance", "2"));
  const glossary = JSON.parse(readFileSync(argValue("--glossary", join(homedir(), ".always", "glossary.json")), "utf-8")) as GlossaryEntry[];
  const logDir = argValue("--log-dir", join(homedir(), "Library", "Logs", "Always"));
  const RAW = "Apple STT result: ";
  const events = readdirSync(logDir)
    .filter((f) => /^always\.\d{4}-\d{2}-\d{2}$/.test(f))
    .sort()
    .flatMap((f) => parseLog(readFileSync(join(logDir, f), "utf-8")));
  const raw = events
    .filter((e) => (e.fields?.message ?? "").startsWith(RAW) && Date.parse(e.timestamp) >= since)
    .map((e) => ({ at: e.timestamp, text: (e.fields!.message as string).slice(RAW.length) }));
  const found = findCandidates(glossary, raw, maxDistance);
  console.log(`${raw.length} raw lines since ${new Date(since).toISOString()} · ${found.length} candidate words (distance 1–${maxDistance})`);
  for (const c of found) console.log(`${c.at.slice(0, 19)}  "${c.word}" ~ ${c.term} (d=${c.distance})  |  ${c.line.slice(0, 160)}`);
}

if (import.meta.main) main();
