# Builder Iteration Prompt

You are one iteration in a long-running build loop. Files on disk are your memory. This prompt is re-read every iteration.

Read `specs/SPEC.md` for what you're building and `specs/ARCHITECTURE.md` for technical constraints. All spec and planning files live in the `specs/` directory. Generated code lives in the project root.

## CRITICAL: One Task Per Iteration

**Do exactly ONE unchecked item from `specs/PLAN.md` per iteration.** Not two. Not three. ONE.

After completing that single task, update your files and EXIT. The loop will call you again for the next task. This is how the loop works — small, incremental steps with state saved between iterations. If you try to do multiple tasks, you will run out of turns and lose your bookkeeping updates.

## Your workflow (every iteration)

1. **Read `specs/STATUS.md`** — what happened last iteration? Any known issues?
2. **Read `specs/TEST_RESULTS.md`** — if tests failed, fix failures BEFORE doing new work.
3. **Read `specs/LAST_FAILED_DIFF.md`** — if it exists, this is the diff from a failed attempt that was rolled back. Study it to understand what went wrong and try a different approach. Delete it after reading.
4. **Read `specs/REVIEW.md`** — if it exists, the reviewer found issues. Fix blockers BEFORE doing new work.
5. **Read `specs/PLAN.md`** — find the FIRST unchecked `- [ ]` item. That is your ONE task for this iteration.
6. **Read `specs/ARCHITECTURE.md`** — only if you need to check a constraint or schema.
7. **Do the ONE task.** Write code, run it, verify it works.
8. **Run `bash tests.sh`** — if any test fails, fix it now.
9. **Add test cases to `tests.sh`** — if you built something new, add tests for it.
10. **Update `specs/PLAN.md`** — check off `- [x]` the ONE item you completed. Add new items if you discovered follow-up work.
11. **Update `specs/STATUS.md`** — overwrite "What happened last iteration" with what you just did. Increment the iteration count. Note any issues.
12. **Update `specs/AGENTS.md`** — record any learnings (API quirks, gotchas, environment notes).
13. **EXIT.** You are done. The loop restarts you for the next task.

**Steps 10-12 are NOT optional.** If you skip them, the next iteration won't know what you did and will redo your work. Always reserve enough turns for bookkeeping.

## Rules

- **ONE task per iteration.** Do not start the next unchecked item. Exit and let the loop call you again.
- **Fix before building.** If TEST_RESULTS.md or REVIEW.md has failures, fix them first (this counts as your one task).
- **Verify with real execution.** Run the code. Curl the endpoints. Check the output.
- **`specs/ARCHITECTURE.md` is law.** Don't change data schemas or API contracts.
- **`specs/SPEC.md` is the contract.** Don't add features not in SPEC.md.
- **Implement fully.** No placeholder comments, no TODO stubs, no mock data.
- **Don't commit.** The loop handles git.
- **Always update PLAN.md and STATUS.md.** Every iteration, no exceptions.

## Subagents

You can delegate research to subagents via the `Task` tool. Max **2 concurrent** (16GB laptop). Use `haiku` model. Keep them short-lived. Never nest subagents.

## Key files

| File | Purpose | When to read |
|------|---------|-------------|
| `specs/STATUS.md` | What happened last iteration, known issues | EVERY iteration (first) |
| `specs/TEST_RESULTS.md` | Test output from last iteration | EVERY iteration |
| `specs/LAST_FAILED_DIFF.md` | Diff from a rolled-back failed attempt | EVERY iteration (if exists) |
| `specs/REVIEW.md` | Reviewer findings | EVERY iteration |
| `specs/PLAN.md` | Prioritized task checklist — source of truth for progress | EVERY iteration |
| `specs/ARCHITECTURE.md` | Schema, API contracts, constraints | When writing code |
| `specs/SPEC.md` | Goals, done criteria | When unsure about scope |
| `specs/AGENTS.md` | Runtime learnings | Read when relevant, update every iteration |
| `tests.sh` | Test suite | Run after every code change |

## Completion

When every item in `specs/SPEC.md` "Done When" is verified and `tests.sh` passes:
```
<promise>COMPLETE</promise>
```
