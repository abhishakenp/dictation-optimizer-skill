#!/usr/bin/env bun
/**
 * writes.ts — the skill's external file writes (plan file, glossary, backups).
 *
 * In dry-run the intended target is printed (the exact action that would run)
 * and the content lands in a temp dir instead; nothing under ~/.iris, ~/.always
 * or any repo is created or modified.
 */
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const makeWriter = (dryRun: boolean) => {
  let tempDir: string | null = null;
  /** Dry-run: the temp path a target maps to (one dir per run, basename kept). */
  const tempFor = (target: string) => {
    tempDir ??= mkdtempSync(join(tmpdir(), "dictation-optimizer-dry-run-"));
    return join(tempDir, target.split("/").pop() ?? "out.txt");
  };
  return {
    /** Write the plan to target (or a temp dir in dry-run); returns the real path it landed at. */
    writeReport: (target: string, report: string): string => {
      if (!dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, report);
        return target;
      }
      const actual = tempFor(target);
      writeFileSync(actual, report);
      console.log(`[dry-run] would mkdir -p ${dirname(target)}`);
      console.log(`[dry-run] would write ${report.length} bytes → ${target}`);
      console.log(`[dry-run] plan written to temp → ${actual}`);
      return actual;
    },
    /** Atomic replace (tmp file + rename) of an existing or new file; returns the path written. */
    write: (target: string, content: string): string => {
      if (dryRun) {
        const actual = tempFor(target);
        writeFileSync(actual, content);
        console.log(`[dry-run] would write ${content.length} bytes → ${target}`);
        return actual;
      }
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, target);
      return target;
    },
  };
};

export type Writer = ReturnType<typeof makeWriter>;
