# Fix Plan

Generated: 2026-02-19
Based on: specs/SPEC.md, specs/ARCHITECTURE.md, specs/AGENTS.md, specs/MILESTONES_REFERENCE.md, specs/STATUS.md, tests.sh

## Current State

Fresh run. Nothing exists yet. No `server.js`, no `fetch-data.py`, no `public/index.html`, no `package.json`, no `data/` directory. All 8 milestones are NOT STARTED. Iteration count: 0.

---

## Priority Tasks (do these first)

- [x] **Create `package.json` and install Express.** ✅ Done. Express installed, node_modules present.

- [x] **Create `fetch-data.py`** ✅ Done. Fetches 291 transactions, overwrites on each run, dedup verified. Also installs paywithextend SDK.

- [x] **Create `data/reviews.json`** ✅ Done. server.js creates it on startup if missing.

- [x] **Create `server.js`** ✅ Done. All 5 violation rules, all API endpoints, static serving. 10/10 tests pass.

- [x] **Create `public/index.html`** ✅ Done. Full dashboard with charts, triage table, modal, bulk actions, CSV export, follow-up message.

---

## Standard Tasks

- [x] **Add detail modal to `public/index.html`** ✅ Done. Click row → modal with transaction details, violation info, action buttons.

- [x] **Add bulk actions to `public/index.html`** ✅ Done. Checkbox column, floating action bar with remind/approve/under_review.

- [x] **Add CSV export to `public/index.html`** ✅ Done. Export CSV button downloads filtered view.

- [x] **Match Extend UI design** (milestone 5). ✅ Done. Sidebar with collapsible sections, teal left border on active item, header with logo + title + Create New + search + avatar, correct color scheme, no dead buttons.

- [x] **Add tests to `tests.sh`** ✅ Done. Tests added for: all 5 violation rules, review state persistence, top-offenders, trends. 19/19 pass.

---

## Polish Tasks (do these last)

- [x] **Polish + edge cases** (milestone 6). ✅ Done. Loading state, empty state (📋 "No transactions found"), error banner, fmtMoney() with Intl.NumberFormat, fmtDate() with locale formatting, refresh button shows "Refreshing..." while in progress.

- [x] **Responsive layout** (milestone 7). ✅ Done. Sidebar collapses to icon-only at 768px (nav labels hidden via .nav-label spans), sidebar hidden at 480px, table-wrapper has overflow-x: auto for horizontal scroll. Verified with Playwright screenshots at both breakpoints.

- [x] **Final QA pass** (milestone 8). ✅ Done. All SPEC.md "Done When" criteria verified via Playwright + API tests. 19/19 tests pass. Screenshot saved to screenshots/dashboard-final-qa.png.

---

## Discovered Issues

- **No files exist at all** — this is a true greenfield build. The builder must create everything from scratch in dependency order: package.json → fetch-data.py (run it) → server.js → public/index.html.
- **`data/` directory** may not exist — `server.js` must create it on startup if missing, or `fetch-data.py` must create it.
- **AGENTS.md critical bug note**: `fetch-data.py` MUST use write mode `'w'` not append `'a'`. Enforce this and verify by running fetch-data.py twice and checking record count doesn't grow.
- **Pagination boundary**: Stop when `len(transactions) < per_page`, not when `count <= perPage`. These are different — `count` is cumulative total; `len(transactions)` is the page size returned. Use `len(transactions) < per_page` as the stop condition per AGENTS.md.
- **HIGH_VELOCITY boundary**: ">5 transactions" means 6+ triggers the violation. Exactly 5 does NOT trigger.
- **ROUND_AMOUNT boundary**: `amount_cents > 10000` (strictly greater). Exactly $100.00 does NOT trigger.
- **MISSING_RECEIPT boundary**: `amount_cents > 2500` (strictly greater). Exactly $25.00 does NOT trigger.

---

## Notes for Builder

- **Environment**: Use `.venv/bin/python3` for Python; `EXTEND_API_KEY` and `EXTEND_API_SECRET` env vars must be set.
- **SDK**: `paywithextend` SDK; use `asyncio.run()` for async methods.
- **API response shape**: `response["report"]["transactions"]` — the data is nested under `report`.
- **Pagination**: Use 1-based page numbering. Stop when the returned page has fewer items than `per_page`.
- **Data directory**: Create `data/` if it doesn't exist before writing files.
- **Reviews file**: `server.js` must create `data/reviews.json` as `{}` on startup if it doesn't exist.
- **Overwrite not append**: `fetch-data.py` must open `data/transactions.json` with `'w'` mode.
- **Sort**: `/api/transactions` must always return results sorted by `date` descending.
- **Static serving**: `server.js` must serve `public/` as static files; `GET /` must return `public/index.html`.
- **No mock data**: Use real transactions from Extend API. No stubs, no placeholders.
- **Amount formatting**: Store as cents internally; format as dollars in the UI (`amount_cents / 100`).
- **ARCHITECTURE.md is law**: Do not deviate from frozen schemas, violation rules, or API contracts.
- **Tests are the oracle**: `bash tests.sh` must pass before marking any task done.
- **Run fetch-data.py twice** after building it to verify overwrite behavior (record count must not grow).
