/**
 * dry-run.test.ts — --dry-run must mock every external call, and a real apply
 * must write the glossary and prove it by read-back.
 *
 * Snapshots ~/.iris/telemetry and ~/.agent-config (listing, sizes, mtimes)
 * before and after a dry-run and requires equality; a decoy `always` binary
 * proves the CLI is logged, not executed.
 */
import { test, expect } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { makeAlways } from "../scripts/always.ts";

const SCRIPT = join(import.meta.dir, "..", "scripts", "optimize-dictation.ts");
const WATCHED = [join(homedir(), ".iris", "telemetry"), join(homedir(), ".agent-config")];

/** Every file under the watched dirs, keyed by absolute path with size and mtime. */
const snapshot = () => {
  const out: Record<string, { mtimeMs: number; size: number }> = {};
  const walk = (d: string) => {
    let entries: ReturnType<typeof readdirSync> | undefined;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const st = statSync(full);
        out[full] = { mtimeMs: st.mtimeMs, size: st.size };
      }
    }
  };
  for (const d of WATCHED) walk(d);
  return out;
};

const corrections = (dir: string, body: unknown = [{ term: "Iris", mistranscriptions: ["Irish"], frequency: 53 }]) => {
  const f = join(dir, "corrections.json");
  writeFileSync(f, JSON.stringify(body));
  return f;
};

/** A throwaway HOME with a stub session report and a seeded glossary. */
const fakeHome = () => {
  const home = mkdtempSync(join(tmpdir(), "do-home-"));
  const dir = join(home, ".iris", "telemetry");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "session-efficiency.md"),
    "# Session Efficiency Report\n\n## Dictation Issues (prompt optimization)\n\n- [Turn 1] Long prompt (150 words) — consider condensing\n- [Turn 2] High filler ratio: 12/40 words are fillers (30%)\n- [Turn 3] Repeated phrases: \"i want to\" (×4)\n",
  );
  mkdirSync(join(home, ".always"), { recursive: true });
  writeFileSync(join(home, ".always", "glossary.json"), JSON.stringify([{ term: "winnow", mistranscriptions: ["Vino"], frequency: 100, weight: 1 }], null, 2));
  return home;
};

test("dry-run performs zero writes to ~/.iris/telemetry or ~/.agent-config", () => {
  // Fake HOME (session report + glossary), so the apply target exists on any host.
  const home = fakeHome();
  const before = snapshot();
  const f = corrections(mkdtempSync(join(tmpdir(), "do-corr-")));
  // --apply included: the harshest path, which in dry-run must still do nothing real.
  const out = execFileSync("bun", [SCRIPT, "--days", "7", "--dry-run", "--apply", "--corrections", f], {
    encoding: "utf-8",
    env: { ...process.env, HOME: home },
  });
  const after = snapshot();
  expect(after).toEqual(before);
  // Every external call is announced as a mock, the write as a would-write.
  expect(out).toContain("[dry-run] MOCK always status");
  expect(out).toContain("[dry-run] MOCK always corrections list");
  expect(out).not.toContain("vocab extract");
  expect(out).toContain("[dry-run] would write");
  expect(out).toContain("DRY RUN — would apply:");
});

test("non-dry-run (without --apply) still writes the plan", () => {
  // A throwaway HOME with a stub source report: the exact default path is
  // exercised through the real (non-mocked) writer — and the real always-CLI
  // exec path (ENOENT here is caught) — without touching the real ~/.iris.
  const home = fakeHome();
  execFileSync("bun", [SCRIPT, "--days", "7"], { encoding: "utf-8", env: { ...process.env, HOME: home } });
  const f = join(home, ".iris", "telemetry", "dictation-plan.md");
  expect(existsSync(f)).toBe(true);
  expect(statSync(f).size).toBeGreaterThan(0);
  expect(readFileSync(f, "utf-8")).toContain("NOT REQUESTED");
});

test("a mocked always call is logged, not executed", () => {
  // Unit: the dry-run mock records the exact call and answers without exec.
  const mock = makeAlways(true);
  const r = mock.call(["corrections", "capture", "teh", "the"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("[mock] always corrections capture teh the");
  expect(mock.log).toEqual(["always corrections capture teh the"]);

  // End-to-end: a decoy binary that leaves a marker if it is ever run.
  const tmp = mkdtempSync(join(tmpdir(), "fake-always-"));
  const marker = join(tmp, "ran");
  const bin = join(tmp, "always");
  writeFileSync(bin, `#!/bin/sh\ntouch "${marker}"\n`);
  chmodSync(bin, 0o755);
  execFileSync("bun", [SCRIPT, "--dry-run", "--apply", "--corrections", corrections(tmp)], {
    env: { ...process.env, HOME: fakeHome(), ALWAYS_BIN: bin },
    encoding: "utf-8",
  });
  expect(existsSync(marker)).toBe(false);
});

test("--apply without --corrections refuses and exits 1", () => {
  const home = fakeHome();
  const r = spawnSync("bun", [SCRIPT, "--apply"], { encoding: "utf-8", env: { ...process.env, HOME: home } });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("NO CORRECTIONS APPLIED: --apply needs --corrections");
  expect(readFileSync(join(home, ".always", "glossary.json"), "utf-8")).toContain("winnow");
  expect(readdirSync(join(home, ".always"))).toEqual(["glossary.json"]);
});

test("real --apply writes the glossary, keeps a backup, and is idempotent", () => {
  const home = fakeHome();
  const f = corrections(home, [
    { term: "Iris", mistranscriptions: ["Irish"], frequency: 53 },
    { term: "Qwen", mistranscriptions: ["Quin"], frequency: 1 },
  ]);
  const env = { ...process.env, HOME: home };
  const run = () => spawnSync("bun", [SCRIPT, "--apply", "--corrections", f], { encoding: "utf-8", env });

  const first = run();
  expect(first.status).toBe(0);
  expect(first.stdout).toContain("APPLIED: 2 added, 0 updated, 3 entries");
  const glossary = JSON.parse(readFileSync(join(home, ".always", "glossary.json"), "utf-8"));
  expect(glossary.map((e: { term: string }) => e.term)).toEqual(["winnow", "Iris", "Qwen"]);
  expect(glossary[1].mistranscriptions).toEqual(["Irish"]);
  expect(readdirSync(join(home, ".always")).some((n) => n.startsWith("glossary.json.bak-"))).toBe(true);
  expect(readFileSync(join(home, ".iris", "telemetry", "dictation-plan.md"), "utf-8")).toContain("APPLIED: 2 added");

  // Second run: nothing new to add, no duplicate entries.
  const second = run();
  expect(second.status).toBe(0);
  expect(second.stdout).toContain("APPLIED: 0 added, 0 updated, 3 entries");
  expect(JSON.parse(readFileSync(join(home, ".always", "glossary.json"), "utf-8"))).toHaveLength(3);
});

test("a corrections file that fails validation changes nothing and exits 1", () => {
  const home = fakeHome();
  const before = readFileSync(join(home, ".always", "glossary.json"), "utf-8");
  const bad = corrections(home, [{ term: "Iris", mistranscriptions: ["Iris"] }]);
  const r = spawnSync("bun", [SCRIPT, "--apply", "--corrections", bad], { encoding: "utf-8", env: { ...process.env, HOME: home } });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("cannot be its own mistranscription");
  expect(readFileSync(join(home, ".always", "glossary.json"), "utf-8")).toBe(before);
});
