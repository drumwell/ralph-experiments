# Development Guidelines (24-Hour Autonomous Operation)

## Context Discipline

You are running in a loop that restarts you every iteration. You have NO memory of previous iterations except what's written to disk. This means:

1. **specs/STATUS.md is your memory.** Read it first. Write to it last. If you don't update it, the next iteration starts blind.
2. **specs/fix_plan.md is your compass.** You own it. It tells you what to do next. Update it every iteration.
3. **specs/ARCHITECTURE.md is your guardrails.** It prevents you from reinventing the architecture every iteration — a common failure mode in long runs.
4. **tests.sh is your oracle.** Run it after every code change. Green means progress. Red means fix before moving on.

## Anti-Drift Mechanisms

Long-running agents tend to drift in predictable ways. Guard against these:

**Scope creep:** Only build what's in specs/SPEC.md. If you think of a cool feature, DON'T add it. Write it in specs/STATUS.md under "Ideas for later" and move on.

**Architecture churn:** Read specs/ARCHITECTURE.md before making structural changes. If you're about to create a new file, add a new dependency, or change the data schema — STOP. Check if specs/ARCHITECTURE.md allows it. If not, find another way.

**Premature completion:** Don't output `<promise>COMPLETE</promise>` unless you've personally verified every item in specs/SPEC.md "Done When". Run tests.sh. Take screenshots. Actually test the features.

**Oscillation:** If you find yourself undoing work from a previous iteration, STOP. Read specs/STATUS.md to understand why it was done that way. If you still think it's wrong, document your reasoning in specs/STATUS.md before changing it.

**Gold plating:** A task is done when tests.sh passes and the feature works. Don't keep polishing. Move to the next task.

## No Cheating

This section exists because autonomous agents predictably cut corners. Do not:

- **Write placeholder code.** No `// TODO`, no `// implement later`, no `pass # placeholder`. If you start a function, finish it. If you can't finish it this iteration, don't start it.
- **Use mock data.** All data comes from the Extend API or `data/transactions.json`. Never hardcode sample data.
- **Stub out logic.** `return true;` or `return [];` when the real logic is complex is cheating. Implement the real logic.
- **Leave dead code.** If you comment something out "for now", delete it instead. Commented-out code confuses future iterations.
- **Skip error handling.** `try { } catch(e) { }` with an empty catch is worse than no try/catch. Handle the error or let it crash.
- **Fake passing tests.** Never modify tests.sh to make a failing test pass by weakening the assertion. Fix the code, not the test.

If you find yourself tempted to do any of the above because you're running low on tool calls, STOP. Update specs/fix_plan.md with what's left to do, update specs/STATUS.md with your progress, and exit. The next iteration will pick up where you left off. A clean partial is better than a hacky complete.

## Freshness

**Rewrite, don't append.** When updating specs/STATUS.md, rewrite the relevant sections rather than appending notes at the bottom. A clean status file is more useful than a long changelog.

**Check your assumptions.** If you're about to write code based on what you "remember" about the data schema, read specs/ARCHITECTURE.md instead. Your memory might be from a different iteration.

## Quality Standards

- **Run it.** Every code change must be executed, not just written.
- **Curl it.** Every API endpoint must be tested with `curl` before marking done.
- **Test it.** Run `bash tests.sh` after every code change. Add new tests for new features.
- **Screenshot it.** UI changes should be verified visually with Playwright. **Save all screenshots to `screenshots/` directory** — never to the project root.
- **No dead UI.** If an element has `cursor: pointer`, it must have a click handler. See specs/ARCHITECTURE.md "Cosmetic vs Functional UI Elements".

## Error Recovery

If you encounter an error:
1. Read the error message carefully
2. Check if it's a known issue in specs/AGENTS.md
3. Fix it in the current iteration
4. Document the fix in specs/AGENTS.md so future iterations don't re-break it

If the same error keeps appearing across iterations, add it to specs/AGENTS.md "Patterns That Failed" with the root cause and fix. This prevents infinite fix loops.

## Code Conventions

- **Simple > clever.** Future iterations need to read your code.
- **Log what you do.** Use `console.log` in server.js, `print(..., flush=True)` in Python.
- **No silent failures.** Catch errors and surface them, don't swallow them.
- **Use the internal schema.** All code references the field names in specs/ARCHITECTURE.md (e.g., `amount_cents`, not `authBillingAmountCents`).
- **Format at display time.** Store cents and ISO dates. Format to `$X,XXX.XX` and locale dates only in the frontend.

## Git

The loop handles git commits automatically. Do NOT commit yourself. You CAN use `git diff` and `git log` to understand what changed in previous iterations — this is encouraged when debugging.

## What "Done" Looks Like

A task is done when:
1. The code works (verified by running it)
2. `bash tests.sh` passes
3. specs/fix_plan.md is updated (task checked off, new work added if discovered)
4. specs/STATUS.md is updated with what was done
5. specs/AGENTS.md is updated with any new learnings

The project is done when every item in specs/SPEC.md "Done When" is verified, tests.sh passes all green, and specs/fix_plan.md has no unchecked items.
