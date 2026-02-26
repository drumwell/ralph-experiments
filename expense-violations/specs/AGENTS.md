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

- **SDK is async:** All `paywithextend` SDK methods are async. Must use `asyncio.run()` in fetch-data.py.
- **Response shape:** `response["report"]["transactions"]`, NOT `response["transactions"]`.
- **Pagination:** `count` field is a running total (not per-page count). On page 1 with perPage=100, count=101. On page 3 (last), count=288 with 88 txns. Stop when `len(transactions) < per_page`.
- **Page numbering:** 1-based (page=1 is first page).
- **Overshoot behavior:** Requesting pages beyond the last returns the last page's data again (duplicates). The pagination stop condition prevents this.
- **288 total transactions** as of 2026-02-12.

## Known Issues

- Favicon 404 (harmless — no favicon.ico exists, not required)
- ROUND_AMOUNT triggers very rarely on real data — only 1 transaction detected (Modal Labs, $100.00). The real data just doesn't have many round amounts >$100.
- 291 total transactions as of 2026-02-19 (AGENTS.md previously said 288 — data has grown)

## Patterns That Failed

**overflow:hidden on triage table container (runs 004, 005, 006, 007):** Do NOT put `overflow: hidden` on `.triage-card` or any container wrapping the triage table. The layout uses `body { height: 100vh; overflow: hidden }` → `.main { overflow: hidden }` → `.content { overflow-y: auto }`. If `.triage-card` also has `overflow: hidden`, the table gets clipped and users can't scroll to see all rows. Fix: remove `overflow: hidden` from `.triage-card`. The border-radius corner clipping can be achieved with `overflow: clip` instead (which clips visually but doesn't create a scroll container). Or just accept minor corner bleed — it's invisible in practice.

## Responsive Layout Pattern

To collapse sidebar at 768px (icon-only) while keeping icons visible:
- Wrap all nav text in `<span class="nav-label">` elements (not text nodes)
- In the `@media (max-width: 768px)` rule, set `.nav-label { display: none }` and adjust widths/padding
- The sidebar-logo-text, sidebar-logo-sub, badge, chevron, nav-submenu, sidebar-footer-text can be hidden separately since they have their own classes
- At 480px: `display: none` on the sidebar hides it entirely
- `.table-wrapper` already has `overflow-x: auto` for horizontal scroll on mobile

## Patterns That Work

- Use `flush=True` in print statements for real-time output
- Save data even on API error to avoid losing fetched data
- Run fetch-data.py TWICE in validation to catch append bugs
- `paywithextend` SDK is NOT pre-installed — must `pip install paywithextend` in `.venv/` first
- SDK `get_transactions()` uses `/reports/transactions/v2` — response shape is `response["report"]["transactions"]` (nested under "report")
- Transaction field mapping for normalization: `merchantName` → merchant, `authBillingAmountCents` → amount_cents, `authedAt` → date, `recipientName` → cardholder, `hasAttachments`+`attachmentsCount` → receipt_missing
- `mccGroup` field available on transactions (e.g., RETAIL, UTILITIES, BUSINESS) — useful for UI display
- Playwright row click sometimes fails due to scroll position — use `page.evaluate()` to click via JS instead
- Playwright viewport defaults to ~513px tall — table rows at the bottom of a small viewport have `.content` div intercepting clicks. Set viewport to 1280x900 before testing row clicks: `page.setViewportSize({width:1280, height:900})`

## Critical Rule

**When you identify a bug, FIX IT — don't just document it and move on.** If something is wrong, the task isn't done.
