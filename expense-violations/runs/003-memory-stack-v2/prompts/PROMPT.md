# Extend Expense Dashboard — Iteration Prompt

You are one iteration in a long-running loop building an expense violation dashboard.
Files on disk are your memory. This prompt is re-read every iteration. Stay focused.

All spec and planning files live in the `specs/` directory. Generated code lives in the project root.

## Your workflow (every iteration)

1. **Read `specs/STATUS.md`** — what milestone are you on? What was done last?
2. **Read `specs/PLAN.md`** — find the current milestone's first unchecked task
3. **Read `specs/ARCHITECTURE.md`** — only if you need to check a constraint or schema
4. **Do ONE task.** Write code, run it, verify it works.
5. **Run the milestone's validation gate** if you just finished the last task in a milestone
6. **Update `specs/STATUS.md`** — record what you did, any decisions, any issues found
7. **Mark completed tasks** with `[x]` in `specs/PLAN.md`
8. **Exit.** The loop restarts you. Don't try to do the next task.

## Rules

- **ONE task per iteration.** You have ~20 tool calls. Use them on one thing done well.
- **Verify with real execution.** Run the code. Curl the endpoints. Don't trust code by reading it.
- **Fix before moving on.** If validation fails, fix it now. Don't skip ahead.
- **`specs/ARCHITECTURE.md` is law.** Don't change the data schema, file boundaries, or violation rules.
- **`specs/SPEC.md` is the contract.** It defines what "done" means. Don't add features not in SPEC.md.
- **Update `specs/STATUS.md` every iteration.** This is how future iterations (and you) know what happened.

## Key files

| File | Purpose | When to read |
|------|---------|-------------|
| `specs/STATUS.md` | What's done, what's next, decisions | EVERY iteration (first thing) |
| `specs/PLAN.md` | Milestones with validation gates | EVERY iteration (find next task) |
| `specs/ARCHITECTURE.md` | Schema, API contracts, UI design specs, constraints | When writing code that touches data/APIs/UI |
| `specs/SPEC.md` | Goals, non-goals, done criteria | When unsure if something is in scope |
| `specs/AGENTS.md` | Runtime learnings, API gotchas, known issues | When you discover something worth recording |
| `specs/CLAUDE.md` | Development guidelines, anti-drift rules | If you need a reminder on how to work |

## Environment

- Python venv: `.venv/` — use `.venv/bin/python3` and `.venv/bin/pip`
- Node: `npm install` for Express
- Server: `node server.js` on port 3000
- API creds: `EXTEND_API_KEY` and `EXTEND_API_SECRET` env vars
- Playwright MCP: available for visual verification (screenshots)

## Verification pattern

```bash
# After any code change:
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/api/summary | python3 -m json.tool
# ... more endpoint checks as needed
pkill -f "node server.js"
```

## Completion

When Milestone 8 passes and every item in `specs/SPEC.md` "Done When" is verified:
```
<promise>COMPLETE</promise>
```

Do NOT output this until you have personally verified every done criterion.
