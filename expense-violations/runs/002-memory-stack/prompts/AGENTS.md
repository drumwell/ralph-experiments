# Operational Learnings

Runtime knowledge discovered during development. This file is a living scratchpad — update it when you discover gotchas, patterns that work, or issues to watch out for.

Frozen constraints (schema, API contracts, UI design, violation rules) live in specs/ARCHITECTURE.md. This file is for operational notes only.

## Environment

- Python venv is at `.venv/` — always use `.venv/bin/python3` and `.venv/bin/pip`
- Environment variables required: `EXTEND_API_KEY`, `EXTEND_API_SECRET`
- Express server runs on port 3000
- Playwright MCP available for visual verification (screenshots)

## API Notes

_Update this section as you discover SDK behavior, field mappings, or API quirks._

## Known Issues

_Track persistent bugs or workarounds here so future iterations don't re-discover them._

## Patterns That Work

- Use `flush=True` in print statements for real-time output
- Save data even on API error to avoid losing fetched data

## Critical Rule

**When you identify a bug, FIX IT — don't just document it and move on.** If something is wrong, the task isn't done.
