#!/usr/bin/env bun
/**
 * optimize-dictation.ts — Read session-efficiency report, extract dictation issues,
 * generate correction plan, optionally apply reviewed corrections to the Always glossary.
 *
 * Usage:
 *   bun run optimize-dictation.ts [--days 30] [--dry-run]
 *     [--corrections <file.json>] [--apply]
 *     [--out ~/.iris/telemetry/dictation-plan.md]
 *
 *   --corrections: JSON array of {term, mistranscriptions[], frequency?}, written by
 *   reading the transcripts yourself. Required with --apply.
 *   --apply: merge the corrections into ~/.always/glossary.json (backup first,
 *   read-back verified). Exits 1 when it cannot apply; never reports success it did not verify.
 *
 *   --dry-run: every external call (always CLI, file writes) is mocked and
 *   logged; the plan lands in a temp dir, nothing under ~/.iris or ~/.always is touched.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeAlways } from "./always";
import { applyGlossary, loadCorrections } from "./glossary";
import { makeWriter } from "./writes";

const DIR = join(homedir(), ".iris", "telemetry");
const argValue = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);

async function main() {
  const days = process.argv.includes("--days") ? Number(process.argv[process.argv.indexOf("--days") + 1]) : 30;
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run");
  const correctionsFile = argValue("--corrections")?.replace(/^~/, homedir());
  const glossaryPath = join(homedir(), ".always", "glossary.json");
  const always = makeAlways(dryRun);
  const writer = makeWriter(dryRun);
  const outFile = argValue("--out")?.replace(/^~/, homedir()) ?? join(DIR, "dictation-plan.md");
  if (dryRun) console.log("[optimize-dictation] DRY RUN — always CLI and file writes mocked");

  // Refuse before any work: --apply without reviewed corrections has nothing to write.
  if (apply && !correctionsFile) {
    console.error("[optimize-dictation] NO CORRECTIONS APPLIED: --apply needs --corrections <file.json>");
    process.exit(1);
  }
  const corrections = apply && correctionsFile ? loadCorrections(correctionsFile) : [];

  // Read session efficiency report
  const effFile = join(DIR, "session-efficiency.md");
  if (!existsSync(effFile)) {
    console.error("[optimize-dictation] Run session-efficiency first: bun run analyze-sessions.ts");
    process.exit(1);
  }
  const report = readFileSync(effFile, "utf-8");

  // Extract dictation issues from report
  const issueLines = report.split("\n").filter((l) => l.startsWith("- [Turn"));
  const longPrompts = issueLines.filter((l) => l.includes("Long prompt"));
  const repeatedPhrases = issueLines.filter((l) => l.includes("Repeated phrases"));
  const fillerIssues = issueLines.filter((l) => l.includes("filler"));

  // Check Always daemon status (mocked, not executed, in dry-run)
  let alwaysStatus = "unknown";
  let alwaysRunning = false;
  const statusRes = always.call(["status"]);
  if (statusRes.code === 0) {
    alwaysStatus = statusRes.stdout.trim().slice(0, 200) || "unknown";
    alwaysRunning = alwaysStatus.includes("running") || alwaysStatus.includes("active");
  } else {
    alwaysStatus = "not available";
  }

  // Check glossary
  let glossaryEntries = 0;
  if (existsSync(glossaryPath)) {
    try {
      const g = JSON.parse(readFileSync(glossaryPath, "utf-8"));
      glossaryEntries = Array.isArray(g) ? g.length : Object.keys(g).length;
    } catch {}
  }

  // Check pending corrections (mocked, not executed, in dry-run)
  const corr = always.call(["corrections", "list"]);
  const pendingCorrections = corr.code === 0 ? corr.stdout.trim().slice(0, 500) || "none" : "command failed";

  // Apply reviewed corrections to the glossary before the plan is written, so the plan records the outcome.
  let actionsLine = "(DRY RUN) — pass --corrections <file.json> --apply to write the glossary";
  let applyFailed = false;
  if (apply) {
    try {
      const r = applyGlossary(glossaryPath, corrections, writer);
      actionsLine = `${dryRun ? "DRY RUN — would apply" : "APPLIED"}: ${r.added.length} added, ${r.updated.length} updated, ${r.total} entries; backup ${r.backup}; read-back verified in ${r.written}`;
      console.log(`[optimize-dictation] ${actionsLine}`);
    } catch (e) {
      applyFailed = true;
      actionsLine = `FAILED — ${(e as Error).message}`;
      console.error(`[optimize-dictation] NO CORRECTIONS APPLIED: ${(e as Error).message}`);
    }
  }

  // Generate correction plan
  const plan = `# Dictation Optimization Plan

Generated: ${new Date().toISOString()}
Source: session-efficiency report (${effFile})

## Always Daemon Status

- Status: ${alwaysStatus}
- Glossary entries: ${glossaryEntries}
- Pending corrections: ${pendingCorrections.slice(0, 200)}

## Issues Found

| Category | Count |
|----------|-------|
| Long prompts (>100 words) | ${longPrompts.length} |
| Repeated phrases | ${repeatedPhrases.length} |
| Filler word issues | ${fillerIssues.length} |
| Total dictation issues | ${issueLines.length} |

## Top 20 Long Prompts

${longPrompts.slice(0, 20).map((l) => `- ${l.trim()}`).join("\n") || "- None"}

## Top 20 Repeated Phrases

${repeatedPhrases.slice(0, 20).map((l) => `- ${l.trim()}`).join("\n") || "- None"}

## Correction Plan

### Step 1: Mistranscription corrections
Authored by reading the transcripts; passed as \`--corrections <file.json>\`.
${corrections.map((c) => `- "${c.mistranscriptions.join('", "')}" → "${c.term}" (${c.frequency} prompts)`).join("\n") || "- None supplied"}

### Step 2: Add filler word filters
The following filler words should be filtered by Always's pipeline:
- "like", "just", "basically", "actually", "really", "very", "so", "well"
- "um", "uh", "hmm", "right", "okay", "yeah", "i mean", "you know"

### Step 3: Add corrections for repeated phrases
For each repeated phrase, create a correction (wrong → right):
${repeatedPhrases.slice(0, 10).map((l) => {
  const match = l.match(/"([^"]+)"/);
  const phrase = match ? match[1] : "unknown";
  return `- "${phrase}" → (condensed version)`;
}).join("\n") || "- None"}

### Step 4: Verify
Re-run \`session-efficiency\` and check the new \`Dictation Issues\` section.

## Actions (${apply ? (dryRun ? "DRY RUN" : "APPLY") : "NOT REQUESTED"})

${actionsLine}

---
*Generated by dictation-optimizer skill.*
`;

  const written = writer.writeReport(outFile, plan);
  console.log(`[optimize-dictation] ${issueLines.length} issues found, ${longPrompts.length} long prompts, ${repeatedPhrases.length} repeated phrases`);
  const alwaysLabel = dryRun ? "MOCK (dry-run, status not queried)" : alwaysRunning ? "running" : "not running";
  console.log(`[optimize-dictation] Always: ${alwaysLabel}, glossary: ${glossaryEntries} entries`);
  console.log(`[optimize-dictation] plan → ${written}`);
  if (applyFailed) process.exit(1);
}

main();
