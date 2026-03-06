# Development Guidelines (Autonomous Operation)

## Context Discipline

You are running in a loop. You have NO memory of previous iterations except what's on disk.

1. **specs/STATUS.md is your memory.** Read first, write last.
2. **specs/PLAN.md is your compass.** Find next task, update when done.
3. **specs/ARCHITECTURE.md is your guardrails.** Prevents architecture drift.
4. **tests.sh is your oracle.** Green = progress. Red = fix first.

## Anti-Drift Mechanisms

**Scope creep:** Only build what's in SPEC.md.

**Architecture churn:** Read ARCHITECTURE.md before structural changes. Don't create new files or dependencies without checking.

**Premature completion:** Don't output `<promise>COMPLETE</promise>` unless you've verified every item in SPEC.md "Done When".

**Oscillation:** If undoing previous work, read STATUS.md first to understand why it was done.

## No Cheating

- **No placeholder code.** No `// TODO`, no `pass # placeholder`.
- **No stubbed logic.** Implement the real computation.
- **No dead code.** Delete, don't comment out.
- **No empty catch blocks.** Handle errors or let them crash.
- **No weakened tests.** Fix the code, not the test.

If running low on tool calls: update PLAN.md and STATUS.md, then exit. The next iteration picks up.

## Code Conventions

- **Simple > clever.**
- **Log what you do.** Logging helps debug across iterations.
- **Use config files** for any settings. Never hardcode values that belong in config.

## Quality Standards

- **Run it.** Every code change must be executed.
- **Test it.** Run `bash tests.sh` after every change.
- **Verify it.** Check actual output, not just exit codes.

## Git

The loop handles commits. Do NOT commit yourself. You CAN use `git diff` and `git log`.
