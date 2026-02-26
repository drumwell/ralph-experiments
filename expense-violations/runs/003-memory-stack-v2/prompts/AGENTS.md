# Operational Learnings

Runtime knowledge discovered during development. This file is a living scratchpad — update it when you discover gotchas, patterns that work, or issues to watch out for.

Frozen constraints (schema, API contracts, UI design, violation rules) live in specs/ARCHITECTURE.md. This file is for operational notes only.

## Environment

- Python venv is at `.venv/` — always use `.venv/bin/python3` and `.venv/bin/pip`
- Environment variables required: `EXTEND_API_KEY`, `EXTEND_API_SECRET`
- Express server runs on port 3000
- Playwright MCP available for visual verification (screenshots)

## Learnings from Previous Runs

**CRITICAL — Duplicate transactions bug (run 002):**
`fetch-data.py` must OVERWRITE `data/transactions.json` every time it runs. In run 002, the script appended to the existing file when called via `/api/refresh`, causing 286 unique transactions to balloon to 1748 records. Use `open('data/transactions.json', 'w')` (write mode), never `'a'` (append). After writing, verify: `len(records) == len(set(r['id'] for r in records))`.

**Table must be sorted:**
The violations table looked sloppy without a default sort order. Always sort by date descending (newest first). Column headers should be clickable to change sort.

**No dead buttons:**
Run 002 had 5 UI elements (Create New+, sidebar nav items, Receipt Tools dropdown, header search icon, user avatar) that looked clickable but did nothing. If an element has `cursor: pointer` it must have a click handler. Otherwise style it as static with `cursor: default`.

**Screenshots go in `screenshots/` directory:**
Run 002 dumped 150 PNGs in the project root. Always `mkdir -p screenshots` and save there.

## API Notes

_Update this section as you discover SDK behavior, field mappings, or API quirks._

## Known Issues

_Track persistent bugs or workarounds here so future iterations don't re-discover them._

## Patterns That Work

- Use `flush=True` in print statements for real-time output
- Save data even on API error to avoid losing fetched data
- Run fetch-data.py TWICE in validation to catch append bugs

## Critical Rule

**When you identify a bug, FIX IT — don't just document it and move on.** If something is wrong, the task isn't done.
