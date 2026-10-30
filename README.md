<div align="center">

# 🎙️ dictation-optimizer

**The agent skill for fixing Always voice-dictation mistranscriptions.**

[![Agent Skill](https://img.shields.io/badge/agent--skill-SKILL.md-blueviolet?style=for-the-badge)](SKILL.md)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-ready-DA7756?style=for-the-badge&logo=anthropic&logoColor=white)](#install)
[![Codex](https://img.shields.io/badge/Codex-ready-412991?style=for-the-badge&logo=openai&logoColor=white)](#install)
[![Cursor](https://img.shields.io/badge/Cursor-ready-000000?style=for-the-badge&logo=cursor&logoColor=white)](#install)
[![Gemini](https://img.shields.io/badge/Gemini-ready-1BA1E3?style=for-the-badge&logo=googlegemini&logoColor=white)](#install)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

*Teach your agent to write the words your dictation gets wrong into the Always glossary.*

</div>

---

## What it does

Drop [`SKILL.md`](SKILL.md) into your agent's skills directory. When the Always daemon hears `Irish` for `Iris`, the agent reads the transcripts, writes a reviewed `wrong → right` file, and applies it to `~/.always/glossary.json`.

| Step | What happens |
|---|---|
| **Review** | The agent reads the transcripts and writes a corrections file. Nothing is guessed by a script. |
| **Apply** | A timestamped backup is taken, the glossary is written atomically, and every pair is read back. |
| **Refuse** | Missing or invalid corrections exit 1 and change nothing. |
| **Dry run** | `--dry-run` mocks every external call and writes to a temp dir. |

## Install

Copy this folder into your agent's skills directory, for example `~/.claude/skills/dictation-optimizer/`. Requires [Bun](https://bun.sh).

## Run

```bash
bun run scripts/optimize-dictation.ts --corrections corrections.json --apply
bun test
```

## Layout

```
SKILL.md                      agent instructions
scripts/optimize-dictation.ts entry point
scripts/glossary.ts           merge, validation, apply
scripts/always.ts             Always CLI seam (mocked in dry run)
scripts/writes.ts             file writes seam (temp dir in dry run)
test/                         bun test suite
```

## License

MIT. See [LICENSE](LICENSE).
