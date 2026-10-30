---
name: dictation-optimizer
description: Fix Always voice-dictation mistranscriptions and review dictation habits from session transcripts. Use when the user says "dictation optimizer", "fix my dictation", "vocabulary update", "always corrections", "Irish instead of Iris", "wrong word in dictation", or wants to improve voice-to-text accuracy. Applies reviewed wrong→right pairs to the Always glossary with backup and read-back verification.
---

# Dictation Optimizer

Improves the [Always](https://github.com/LivioGama/always) voice daemon's accuracy by writing reviewed `wrong → right` pairs into its glossary, and reports dictation habits from session analysis.

## Inputs

- `~/.always/glossary.json`: the glossary the daemon compiles. A JSON array of `{term, mistranscriptions[], frequency, weight, provenance}`.
- `~/.iris/telemetry/session-efficiency.md`: the session report the script reads for habit counts. Produced by a session-efficiency analyzer, not included here. The apply path does not need it beyond existing.
- Corrections file: JSON you write after reading the transcripts yourself:

```json
[
  { "term": "Iris", "mistranscriptions": ["Irish"], "frequency": 53 },
  { "term": "Qwen", "mistranscriptions": ["Quin"], "frequency": 1 }
]
```

Do not generate corrections with a script. Read the transcripts and decide which words the recogniser got wrong.

## Usage

```bash
bun run scripts/optimize-dictation.ts [--days 30] [--dry-run] [--corrections corrections.json] [--apply]
```

| Flag | Effect |
|---|---|
| (none) | Writes the plan to `~/.iris/telemetry/dictation-plan.md`. Glossary untouched. |
| `--corrections <file>` | Required with `--apply`. Validated before any write. |
| `--apply` | Merges the corrections into the glossary: timestamped backup, atomic write, read-back of every pair. Exits 1 on any failure. |
| `--dry-run` | Every external call and write is mocked and logged. Writes land in a temp dir. |

`always vocab extract` is not used. The Always binary stubs it and exits 0, so a success exit code proves nothing.

## Verification

- `bun test` runs the suite in a fake HOME. It does not touch `~/.always` or `~/.iris`.
- The Always daemon recompiles its vocabulary when the glossary is written. Check the daemon log for a `vocab_match_compiled` event after the apply.

## Limits

- Corrections take effect in the daemon's matcher. Whether a given utterance is corrected needs live dictation to confirm.
- No CLI can enqueue a correction non-interactively. `always corrections approve` only drains a queue that `corrections capture` (needs a live text selection) fills.
