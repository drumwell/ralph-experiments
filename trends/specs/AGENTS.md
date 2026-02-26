# Operational Learnings

Runtime knowledge discovered during development. This file is a living scratchpad — update it when you discover gotchas, patterns that work, or issues to watch out for.

Frozen constraints (schema, API contracts, outlier rules) live in specs/ARCHITECTURE.md. This file is for operational notes only.

## Environment

- Python venv is at `.venv/` — always use `.venv/bin/python3` and `.venv/bin/pip`
- Environment variables required: `EXTEND_API_KEY`, `EXTEND_API_SECRET`
- Express server runs on port 3000
- Playwright MCP available for visual verification (screenshots)
- Node package manager: npm (use `npm install` to install dependencies from package.json)

## API Notes

- **SDK is async:** All `paywithextend` SDK methods are async. Must use `asyncio.run()` in fetch-data.py.
- **SDK method name:** Use `client.transactions.get_transactions(page=X, per_page=Y)`, NOT `client.get_transactions()` or `client.transactions.list()`.
- **Response shape:** `response["report"]["transactions"]`, NOT `response["transactions"]`.
- **Pagination:** `count` field is a running total (not per-page count). Stop when `len(transactions) < per_page`.
- **Page numbering:** 1-based (page=1 is first page).
- **Overshoot behavior:** Requesting pages beyond the last returns the last page's data again (duplicates). The pagination stop condition prevents this.
- **~290+ total transactions** as of 2026-02-24.
- **Null fields in DECLINED transactions:** DECLINED transactions may have null `mcc`, `authBillingAmountCents`, and `authedAt` fields. Server normalization should handle these gracefully.
- **`paywithextend` SDK is NOT pre-installed** — must `pip install paywithextend` in `.venv/` first, every fresh run.
- **Transaction field mapping:** `merchantName` → merchant, `authBillingAmountCents` → amount_cents, `authedAt` → date, `recipientName` → cardholder, `hasAttachments`+`attachmentsCount` → receipt_missing, `mccGroup` → mcc_group

## Patterns That Work

- Use `flush=True` in print statements for real-time output
- Save data even on API error to avoid losing fetched data
- Run fetch-data.py TWICE in validation to catch append bugs
- File always overwritten with 'w' mode (prevents duplicate accumulation)

## Known Issues

- Favicon 404 (harmless — no favicon.ico exists, not required)
- DECLINED and NO_MATCH transactions often have null `mcc`, `authBillingAmountCents`, and `authedAt` fields — handle with defaults in normalization

## Cardholders Page Pattern

- Use `/api/cardholders` (not `/api/top-spenders`) for the cardholders table — returns ALL cardholders with `avg_transaction_cents`
- `/api/top-spenders` returns top 5 only — suitable for Overview page summary cards only
- Cardholder table has 6 columns: Name, Total Spend, Transactions, Outliers, Top Category, Avg Transaction

## Comparison Toggle Pattern

- Comparison works for BOTH explicit date ranges AND "All" preset
- Explicit range: compute previous period as same-length window before `from`; fetch `/api/trends?from=&to=`
- "All" preset: split `trendsAll` in half — `trendsAll.slice(0, mid)` = previous, `trendsAll.slice(mid)` = current
- Reassign `trends = trendsAll.slice(mid)` so downstream chart rendering uses only the current half
- Use "Day N" relative labels on X-axis when showing dual series (current + previous have different dates)
- tr-spend: adds "Previous Period" dataset, changes "Daily Spend" label to "Current Period"
- tr-count and tr-avg: also show dual series; tr-cumul and tr-dow remain single series

## Mobile Hamburger Pattern

- Hamburger button `#hamburger` is `display:none` by default; `display:flex` at ≤480px media query
- Sidebar gets `#sidebar.mobile-open { display:flex !important; position:fixed; z-index:1000 }` at ≤480px
- Backdrop `#sidebar-backdrop` is `display:none`; `.visible` class shows it as fixed overlay with z-index 999
- `toggleSidebar()` toggles both `mobile-open` on sidebar and `visible` on backdrop
- hashchange listener removes both classes on navigation — sidebar closes automatically

## Toast Pattern

- Toast has `display:flex; gap:10px` layout with message `<span>` and `<button class="toast-close">`
- Close button calls `el.remove()` immediately
- Auto-dismiss uses `setTimeout(() => { if (el.parentNode) el.remove(); }, 3000)` — guards against already-removed elements

## escAttr Order

- Always escape `\` BEFORE `'` — not the other way around
- Wrong order: `replace(/'/g,"\\'").replace(/\\/g,'\\\\')` — double-escapes the backslash in `\'`
- Correct order: `replace(/\\/g,'\\\\').replace(/'/g,"\\'")`

## Critical Rule

**When you identify a bug, FIX IT — don't just document it and move on.** If something is wrong, the task isn't done.
