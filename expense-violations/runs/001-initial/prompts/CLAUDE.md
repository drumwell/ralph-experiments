# Development Approach

## Start Each Iteration With Reflection

Before diving into the next task, **assess the current state**:

1. **Run the app** — does it actually work? Start `node server.js`, open http://localhost:3000, check the console.
2. **Compare to the goal** — does the output match what we're trying to build (Extend UI)?
3. **Ask yourself:**
   - Is the previous task *actually* done, or just "code written"?
   - Are there bugs or visual issues that need fixing first?
   - Does the task list need adjustment based on what I'm seeing?

If something is broken or doesn't look right, **fix it before moving on** — even if it means adding a new task or re-opening a "completed" one.

## One Task Per Iteration (CRITICAL)

**DO NOT do multiple tasks in one session.** Pick ONE task, complete it, commit, EXIT.

The loop will restart you with a fresh context. This is intentional — it prevents context pollution and ensures each task is properly isolated.

1. **Reflect first** — run the app, assess current state visually
2. **Adjust if needed** — add/modify tasks in IMPLEMENTATION_PLAN.md if you spot issues
3. Read IMPLEMENTATION_PLAN.md to find the FIRST uncompleted task ([ ])
4. Do ONLY that task — nothing else
5. Verify it works (run the code, check the output visually)
6. Mark it complete with [x] in IMPLEMENTATION_PLAN.md
7. EXIT immediately — do not continue to the next task

**Why this matters:** Each iteration gets a fresh 200K context window. If you try to do everything at once, you'll run out of context and make mistakes. Trust the loop.

## Quality Over Checkboxes

A task isn't done just because you wrote code. It's done when:
- The code runs without errors
- The output looks correct visually
- It matches the reference (Extend UI) reasonably well
- You would be comfortable showing it to someone

If you check something off and the next iteration finds it broken, **uncheck it and fix it**.

## Search Before Implementing

**Don't assume something isn't implemented.** Before writing new code:
- Search the codebase for existing implementations
- Check if a file already exists
- Read existing code to understand patterns

This prevents duplicate work and wasted iterations.

## Red-Green-Refactor

1. **Red:** Write a test or verification check that fails (endpoint returns error, missing data, wrong format)
2. **Green:** Write minimal code to make it pass
3. **Refactor:** Clean up while keeping tests green

## Run It To Prove It

Don't trust code by reading it. Run it.

- **Data fetching:** Use the Extend API via `paywithextend` SDK to get real data
- **Validation:** Start a local server instance and hit actual endpoints

```bash
# Start local server
node server.js &
sleep 2

# Validate endpoints actually work
curl -sf http://localhost:3000/api/summary | python3 -m json.tool
curl -sf http://localhost:3000/api/violations | head -20

# Check the response has real data, not empty arrays or placeholder values
```

If curl fails or returns unexpected data, the code is broken. Fix it before moving on.

## Verify Early, Verify Often

- After creating any file, immediately test it runs
- After any code change, run the verification loop
- Don't stack multiple untested changes

## When Something Breaks

- Stop and fix before moving on
- Don't comment out broken code to "come back later"
- Print actual error messages — never swallow exceptions silently
- If the Extend API returns an error, surface it clearly and stop

## Code Style

- Simple > clever
- Fewer files > more files
- Log what you're doing so errors are traceable
- Use real field names from the actual API response, not guesses

## Completion

When ALL tasks in IMPLEMENTATION_PLAN.md are complete and verified:

```
<promise>COMPLETE</promise>
```

This signals the loop to exit. Don't output this until everything actually works.
