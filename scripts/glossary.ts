#!/usr/bin/env bun
/**
 * glossary.ts — apply (wrong → right) dictation corrections to the Always glossary.
 *
 * The corrections are authored by reading the transcripts (manual reading, not
 * a script's guess) and passed as a JSON file:
 *   [{ "term": "Iris", "mistranscriptions": ["Irish"], "frequency": 53 }]
 *
 * Always's `corrections approve` only drains a queue that no CLI can fill
 * non-interactively (`corrections capture` needs a live text selection), so the
 * glossary is written directly: backup → atomic write → read-back check.
 */
import { readFileSync } from "node:fs";
import type { Writer } from "./writes.ts";

export interface Correction {
  term: string;
  mistranscriptions: string[];
  frequency: number;
}

export interface GlossaryEntry {
  term: string;
  mistranscriptions?: string[];
  frequency?: number;
  weight?: number;
  provenance?: string;
}

export const loadCorrections = (path: string): Correction[] => {
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array of {term, mistranscriptions[]}`);
  return raw.map((c, i) => {
    const where = `${path}[${i}]`;
    const term = typeof c?.term === "string" ? c.term.trim() : "";
    if (!term) throw new Error(`${where}: term must be a non-empty string`);
    const list: unknown = c.mistranscriptions;
    if (!Array.isArray(list) || list.length === 0) throw new Error(`${where}: mistranscriptions must be a non-empty array`);
    const mistranscriptions = [...new Set(list.map((m) => (typeof m === "string" ? m.trim() : "")))];
    if (mistranscriptions.some((m) => !m)) throw new Error(`${where}: mistranscriptions must be non-empty strings`);
    if (mistranscriptions.includes(term)) throw new Error(`${where}: "${term}" cannot be its own mistranscription`);
    const frequency = Number.isFinite(c.frequency) ? Number(c.frequency) : 1;
    return { term, mistranscriptions, frequency };
  });
};

/** Pure merge: existing terms gain any new mistranscriptions; unknown terms are appended. */
export const mergeGlossary = (entries: GlossaryEntry[], corrections: Correction[]) => {
  const next = entries.map((e) => ({ ...e, mistranscriptions: [...(e.mistranscriptions ?? [])] }));
  const added: string[] = [];
  const updated: string[] = [];
  for (const c of corrections) {
    const hit = next.find((e) => e.term === c.term);
    if (!hit) {
      next.push({ term: c.term, mistranscriptions: c.mistranscriptions, frequency: c.frequency, weight: 1, provenance: "dictation-optimizer" });
      added.push(c.term);
      continue;
    }
    const before = hit.mistranscriptions!.length;
    hit.mistranscriptions = [...new Set([...hit.mistranscriptions!, ...c.mistranscriptions])];
    if (hit.mistranscriptions.length > before) updated.push(c.term);
  }
  return { entries: next, added, updated };
};

/** Backup → atomic write → read-back. Throws if any correction is not in the file afterwards. */
export const applyGlossary = (glossaryPath: string, corrections: Correction[], writer: Writer, now = new Date()) => {
  const original = readFileSync(glossaryPath, "utf-8");
  const parsed: unknown = JSON.parse(original);
  if (!Array.isArray(parsed)) throw new Error(`${glossaryPath}: expected a JSON array`);
  const merged = mergeGlossary(parsed as GlossaryEntry[], corrections);
  const backup = writer.write(`${glossaryPath}.bak-${now.toISOString().replace(/[:.]/g, "-")}`, original);
  const written = writer.write(glossaryPath, `${JSON.stringify(merged.entries, null, 2)}\n`);
  const readBack = JSON.parse(readFileSync(written, "utf-8")) as GlossaryEntry[];
  const missing = corrections.flatMap((c) => {
    const e = readBack.find((x) => x.term === c.term);
    return c.mistranscriptions.filter((m) => !e?.mistranscriptions?.includes(m)).map((m) => `${c.term} ← ${m}`);
  });
  if (missing.length) throw new Error(`read-back missing: ${missing.join(", ")}`);
  return { added: merged.added, updated: merged.updated, backup, written, total: readBack.length };
};
