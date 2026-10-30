#!/usr/bin/env bun
/**
 * always.ts — the Always voice daemon CLI, behind one seam.
 *
 * In dry-run each call is logged with its exact arguments and answered with a
 * mock result; the binary is never invoked. Override the binary with ALWAYS_BIN
 * (tests point it at a decoy that would leave a marker if ever executed).
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const ALWAYS_BIN = process.env.ALWAYS_BIN ?? join(homedir(), ".cargo", "bin", "always");

export interface AlwaysResult {
  stdout: string;
  code: number;
}

export const makeAlways = (dryRun: boolean) => {
  const log: string[] = [];
  return {
    /** Every call made, in order (mocked or real). */
    log,
    /** Run `always <args>`; in dry-run, log it and answer with a mock instead. */
    call: (args: string[]): AlwaysResult => {
      const detail = `always ${args.join(" ")}`;
      if (dryRun) {
        log.push(detail);
        console.log(`[dry-run] MOCK ${detail}`);
        return { stdout: `[mock] ${detail}`, code: 0 };
      }
      try {
        const stdout = execFileSync(ALWAYS_BIN, args, { encoding: "utf-8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
        log.push(detail);
        return { stdout, code: 0 };
      } catch (e: any) {
        log.push(`${detail} (exit ${e.status ?? "?"})`);
        return { stdout: String(e.stdout ?? "") || String(e.stderr ?? ""), code: e.status ?? 1 };
      }
    },
  };
};
