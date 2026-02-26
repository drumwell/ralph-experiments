# Run 001 — Initial Build

**Date:** Feb 4–5, 2026
**Model:** Sonnet
**Total iterations:** 44 (39 log files; iters 21, 34, 37 missing from logs)
**Max turns per iteration:** 20

## Outcome

Successfully built the Extend Expense Policy Dashboard end-to-end: data fetching from Extend API, Express server with violation detection, and a single-page HTML dashboard styled to match Extend's production UI.

## What worked

- Backend built quickly and cleanly (iterations 10–14)
- Violation detection rules all correct on first pass
- AGENTS.md served as an effective UI reference — Claude followed the color palette, layout specs, and component structure closely
- One-task-per-iteration rule kept each iteration focused and productive

## What didn't work

- **5 iterations produced 0-byte logs** (iters 9, 18, 29, 33, 40) — Claude hung when tasks were vague or when hitting API/turn limits with no stdout flushed
- **8 iterations output `<promise>COMPLETE</promise>`** but the loop continued because new tasks kept getting added to the plan
- Early iterations (1–8) failed with "Credit balance too low" before real work began
- Final two tasks ("Test responsive behavior", "Verify 95% match") had no concrete acceptance criteria, causing the loop to stall until they were rewritten with Playwright MCP-based verification

## Key fix applied mid-run

Added Playwright MCP server for visual verification. Rewrote the final two tasks with concrete procedures: screenshot at 1280/768/480px, compare against AGENTS.md spec. Loop completed successfully after this change.

## Git commits (4 total)

1. `d98a317` — Add fetch-data.py to retrieve Extend transactions
2. `a8f4026` — Add Express server with violation detection API
3. `49a72fd` — Add dashboard UI with Chart.js visualizations
4. `60898b4` — Fix duplicate transaction data by deduplicating in fetch-data.py

## Reconstruction

Run `./output/run.sh` to reconstruct and launch the dashboard. Requires Node.js, Python 3.11+, and Extend API credentials. The script installs deps, re-fetches data from the API, and starts the server.

**Note:** `data/transactions.json` was not archived (oversight during cleanup). The data must be re-fetched from the Extend API. Future archives should copy `data/` before cleaning.

## Screenshots

- `desktop-1280.png` — Full dashboard at 1280px
- `tablet-768.png` — Tablet view at 768px
- `mobile-480.png` — Mobile view at 480px
- `final-verification-1280px.png` — Final verification screenshot
- `final-verification-table.png` — Close-up of violations table
