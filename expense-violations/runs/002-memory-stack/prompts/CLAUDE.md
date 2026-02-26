# Development Guidelines (24-Hour Autonomous Operation)

## Context Discipline

You are running in a loop that restarts you every iteration. You have NO memory of previous iterations except what's written to disk. This means:

1. **specs/STATUS.md is your memory.** Read it first. Write to it last. If you don't update it, the next iteration starts blind.
2. **specs/PLAN.md is your compass.** It tells you what to do. Don't freelance.
3. **specs/ARCHITECTURE.md is your guardrails.** It prevents you from reinventing the architecture every iteration — a common failure mode in long runs.

## Anti-Drift Mechanisms

Long-running agents tend to drift in predictable ways. Guard against these:

**Scope creep:** Only build what's in specs/SPEC.md. If you think of a cool feature, DON'T add it. Write it in specs/STATUS.md under "Ideas for later" and move on.

**Architecture churn:** Read specs/ARCHITECTURE.md before making structural changes. If you're about to create a new file, add a new dependency, or change the data schema — STOP. Check if specs/ARCHITECTURE.md allows it. If not, find another way.

**Premature completion:** Don't output `<promise>COMPLETE</promise>` unless you've personally verified every item in specs/SPEC.md "Done When". Run the validation gates. Take screenshots. Actually test the features.

**Oscillation:** If you find yourself undoing work from a previous iteration, STOP. Read specs/STATUS.md to understand why it was done that way. If you still think it's wrong, document your reasoning in specs/STATUS.md before changing it.

**Gold plating:** A task is done when it passes its validation gate. Don't keep polishing. Move to the next task.

## Freshness

**Rewrite, don't append.** When updating specs/STATUS.md, rewrite the relevant sections rather than appending notes at the bottom. A clean status file is more useful than a long changelog.

**Check your assumptions.** If you're about to write code based on what you "remember" about the data schema, read specs/ARCHITECTURE.md instead. Your memory might be from a different iteration.

## Quality Standards

- **Run it.** Every code change must be executed, not just written.
- **Curl it.** Every API endpoint must be tested with `curl` before marking done.
- **Screenshot it.** Every UI change (Milestones 3+) should be verified visually with Playwright.
- **One task.** Complete one task per iteration. Don't try to do two — you'll run out of tool calls and leave both half-done.

## Error Recovery

If you encounter an error:
1. Read the error message carefully
2. Check if it's a known issue in specs/STATUS.md
3. Fix it in the current iteration
4. Document the fix in specs/STATUS.md so future iterations don't re-break it

If the same error keeps appearing across iterations, add it to specs/STATUS.md "Known Issues" with the root cause and fix. This prevents infinite fix loops.

## Code Conventions

- **Simple > clever.** Future iterations need to read your code.
- **Log what you do.** Use `console.log` in server.js, `print(..., flush=True)` in Python.
- **No silent failures.** Catch errors and surface them, don't swallow them.
- **Use the internal schema.** All code references the field names in specs/ARCHITECTURE.md (e.g., `amount_cents`, not `authBillingAmountCents`).
- **Format at display time.** Store cents and ISO dates. Format to `$X,XXX.XX` and locale dates only in the frontend.

## Commit Discipline

Commit after completing each milestone (not each task). Use descriptive messages:
```
git add -A && git commit -m "Milestone N: brief description of what was built"
```

## What "Done" Looks Like

A milestone is done when:
1. All its tasks are checked off in specs/PLAN.md
2. Its validation gate passes (every command succeeds)
3. specs/STATUS.md is updated with what was done
4. If it's a UI milestone, a Playwright screenshot confirms visual correctness

The project is done when Milestone 8 passes and specs/SPEC.md "Done When" is fully verified.
