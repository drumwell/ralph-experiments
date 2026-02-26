# Fix Plan

Generated: 2026-02-24
Based on: SPEC.md, ARCHITECTURE.md, AGENTS.md, MILESTONES_REFERENCE.md, STATUS.md, tests.sh, run-ralph.sh

## Project State

**All milestones implemented. 37 tests passing. All REVIEW.md warnings fixed.**

Built: `fetch-data.py`, `server.js`, `public/index.html`, `package.json`, `data/transactions.json`, `data/triage.json`.
293 transactions, 38 with outliers.

---

## REVIEW.md Fixes (iterations 4 + 7 — ALL DONE)

- [x] Add `/api/cardholders` endpoint returning all cardholders with `avg_transaction_cents`
- [x] Fix Cardholders page to use `/api/cardholders` (was `/api/top-spenders` — limited to 5)
- [x] Add Avg Transaction column to cardholder table (now 6 columns per spec)
- [x] Fix comparison toggle to show dual series on Trends charts (spend, count, avg)
- [x] Fix `escAttr` escape order (backslash before apostrophe)
- [x] Update STATUS.md to reflect current reality
- [x] Add ✕ close button to toast notifications (SPEC requirement)
- [x] Add hamburger menu at ≤480px with overlay sidebar and backdrop
- [x] Fix comparison toggle to work with "All" preset (split data in half)
- [x] Add credentials guard to bulk remind (matches single remind behavior)

---

## Priority Tasks (do these first — unblocks everything else)

- [x] **[M1] Data Layer: fetch-data.py + transactions.json.**

- [x] **[M2] Server Core: server.js with all endpoints, outlier detection, and triage.**

---

## Standard Tasks

- [x] **[M Date Range Filtering + Comparison API + Summary Sparklines.** Add `from`/`to` query param parsing to ALL READ endpoints (filter normalized transactions before computing aggregates). Implement `GET /api/comparison?from=&to=`: compute current period stats and previous period (same-length window before `from`, or first/second half if no range), return `{current, previous, deltas}` with percentage changes. Add `sparklines` field to `/api/summary` (last 7 days of filtered range for spend, count, outliers, avg). Add `cumulative_cents` (running total) to `/api/trends`. Add `category` param to `/api/transactions` for category drill-down. **Why:** Global date range is used on every page and in tests.sh. **Verify:** `bash tests.sh` — "Date Range & Comparison API" section all green. Spot-check: `curl "localhost:3000/api/summary?from=2026-01-01&to=2026-01-31"` returns only Jan data.

- [x] **[M Cardholder Profile API + Enhanced Categories.** Implement `GET /api/cardholder/:name?from=&to=`: URL-decode the name param, return full profile with `cardholder`, `total_spend_cents`, `transaction_count`, `outlier_count`, `avg_transaction_cents`, `top_categories` (array), `spending_timeline` (all their transactions by date), `outlier_transactions` (flagged txns with outlier details), `missing_receipt_transactions` (txns where receipt_missing===true). Enhance `GET /api/categories`: add `avg_cents`, `outlier_count`, `sparkline` (last 7 days of spend for that category); add `all=true` param to return all categories (not just top 10). Add `outlier_count` and `top_category` fields to `/api/top-spenders`. **Why:** Needed for Cardholders and Categories pages. **Verify:** `bash tests.sh` — "Cardholder API" and "Enhanced Categories" sections all green.

- [x] **[M Client-Side Routing Shell (public/index.html).** Create `public/index.html` with: sidebar (functional nav links for all 5 pages with `#/overview` etc., decorative items with `cursor:default`, Extend brand mark, "JB"/"Card Manager" user area, shortcut hints "G O" etc.); header (dynamic page title, refresh timestamp placeholder, date range indicator, decorative elements with `cursor:default`); main content area; hash-based router (listen to `hashchange`, parse `location.hash`, call per-page render functions, default empty/`#/` → `#/overview`); `appState` object (`dateRange: {from:null,to:null,preset:'all'}`, `comparison:false`, `currentPage:'overview'`); skeleton page functions for all 5 routes; Chart.js via CDN; Google Fonts via CDN. **Why:** All UI depends on routing shell. **Verify:** `bash tests.sh` — "Static Serving", "Client-Side Routing", "Sidebar Navigation", "Responsive Design" (media queries check) sections pass. Browser back/forward works.

- [x] **[M Overview Page.** Implement `renderOverview()`: fetch `/api/summary` + `/api/comparison` and render 4 summary cards (Total Spend, Transaction Count, Outliers Detected, Avg Transaction) with sparklines (use inline Chart.js canvas per card) and period delta badges; fetch `/api/trends` and render spend over time area chart with 7-day moving average overlay; fetch `/api/categories` and render category breakdown horizontal bar chart (top 10); fetch `/api/transactions?status=flagged&limit=5` and render quick-view outlier table with "View all →" link to `#/outliers`; fetch `/api/transactions?status=all&limit=10` and render recent activity feed (last 10 transactions as compact list). Show loading skeletons while fetching, error states if fetch fails. **Why:** First page the user sees. **Verify:** Server running + Playwright: navigate to `#/overview`, 4 summary cards visible with numeric content, charts rendered (canvas elements with height > 0), outlier table has rows, activity feed has items.

- [x] **[M Trends Page.** Implement `renderTrends()`: date range picker UI (preset buttons 7d/30d/90d/All + custom date inputs `from`/`to`); period comparison toggle checkbox; on date change update `appState.dateRange` and re-render all charts; on comparison toggle update `appState.comparison` and re-render; render 5 charts from `/api/trends` and `/api/day-of-week`: spend over time (area + moving avg line), daily transaction count, avg transaction size over time, cumulative spend (running total), day-of-week heatmap (bar chart); when comparison ON fetch `/api/comparison` and show dual series (current vs previous period) on spend/count/avg charts. Update header to show active date range indicator. **Why:** Date range is global — must work and persist across pages. **Verify:** Date presets change charts. Custom date inputs filter data. Comparison toggle shows dual series. Navigate to other pages — date range persists in `appState`.

- [x] **[M Categories Page.** Implement `renderCategories()`: fetch `/api/categories?all=true` and render category bar chart (all categories, not just top 10); render category table with columns: Category, Total Spend, Count, % of Total, Avg Transaction, Outlier Count, Sparkline (mini Chart.js line per row); clicking a category row expands or navigates to show filtered transactions (fetch `/api/transactions?status=all&category=MCC_GROUP&limit=25`); category sparklines render as inline canvas elements. **Why:** Categories page requires enhanced categories API built in M4. **Verify:** Category table has rows with sparkline canvases. Clicking a row shows that category's transactions. Bar chart renders.

- [x] **[M Cardholders Page.** Implement `renderCardholders()`: fetch `/api/top-spenders` for initial cardholder list; render cardholder table with columns: Name, Total Spend, Transaction Count, Outlier Count, Top Category, Avg Transaction; search input filters by name (client-side filter on loaded data); column headers toggle sort (asc/desc); clicking a row expands inline profile — fetch `/api/cardholder/:name` and render: spending timeline chart (line chart of their transactions), top categories chart (bar chart), outlier history list (flagged transactions with outlier context); "Send Receipt Reminders" button calls `POST /api/actions/remind` for each `missing_receipt_transactions` entry and shows toast on success/error. **Why:** Per SPEC.md §Cardholders page requirements. **Verify:** Cardholder table renders with sort. Search filters rows. Clicking row expands profile with charts. Receipt reminder button triggers API and shows toast.

- [x] **[M1 Outliers Page — Full Triage Workflow.** Implement `renderOutliers()`: status bucket tabs (Flagged | Acknowledged | Investigating | All) with counts from `counts` field; inline filter row (Type dropdown for rule_id, Severity dropdown, Search input debounced 300ms, Export CSV button, Refresh Data button); transaction table with checkbox column + 6 data columns in exact order: Date, Merchant (with mcc_group secondary), Category (badge/pill), Card (with vcn_last4), Card User, Amount (right-aligned, status indicator); column header click toggles sort; severity badges (HIGH/MEDIUM/LOW with distinct colors); pagination (25 per page); row click opens detail modal with full transaction details, outlier context cards (one card per outlier), Acknowledge/Investigate triage buttons, Send Receipt Reminder button (conditional on receipt_missing); triage action moves transaction between tabs and updates counts; checkbox "select all" in header; floating action bar when rows selected (Send Reminders, Acknowledge, Investigate bulk actions via `POST /api/actions/bulk`); Export CSV downloads current filtered view as a CSV file; Refresh Data calls `POST /api/refresh` and reloads; `j`/`k` keyboard navigation for table rows, `Enter` opens modal. **Why:** Core action page — most complex. **Verify:** `bash tests.sh` — Triage State Persistence tests pass. Tabs switch correctly. Modal opens on row click with outlier context cards. Bulk actions work. CSV downloads.

- [x] **[M1 Command Palette + Keyboard Shortcuts.** Add command palette overlay (triggered by `Cmd+K` / `Ctrl+K`): searches page names (Overview, Trends, etc.), recent transactions (by merchant/cardholder from loaded data), and actions (Refresh Data, Export CSV); results update as you type (debounced 200ms); arrow keys navigate, Enter selects (navigates to page or triggers action), Escape closes; styled like Linear's command palette. Add keyboard shortcuts: `g o` → `#/overview`, `g t` → `#/trends`, `g c` → `#/categories`, `g h` → `#/cardholders`, `g l` → `#/outliers` (chord: keydown `g` starts 500ms window for second key); `Escape` closes modal/palette; `?` opens keyboard shortcut help overlay showing all shortcuts in a modal. Show shortcut hints in sidebar nav items (already started in M5). **Why:** Per SPEC.md §Keyboard Shortcuts. tests.sh checks for these. **Verify:** `bash tests.sh` — "Command Palette & Keyboard Shortcuts" section passes. All `g X` shortcuts navigate correctly. `?` shows overlay.

---

## Polish Tasks (do these last)

- [x] **[M1 UI Design + Polish.** Apply cohesive visual design: choose a dark/muted palette (inspired by Linear/Ramp/Vercel), load premium Google Fonts, implement consistent spacing scale. Style: sidebar (active state indicator, brand mark), header (dynamic title, date range indicator), summary cards (clean layout, sparklines integrated), charts (custom Chart.js color palette, styled tooltips and gridlines), category table (row borders, hover states, sparkline column), outlier table (right-aligned amounts with tabular nums, severity badges colored HIGH=red/MEDIUM=amber/LOW=slate), detail modal (shadow/backdrop, context cards visually distinct), floating action bar, pagination, command palette (dark overlay + white card). Add: toast notifications (styled, stack from bottom-right, auto-dismiss 3s); loading skeleton loaders for charts and tables; empty states (no results, empty tabs); error states with retry; smooth page transitions (CSS fade). Ensure ALL decorative elements have `cursor:default` and no hover effects. **Why:** Per SPEC.md creative brief and "No dead UI" rule. **Verify:** `bash tests.sh` — all tests still pass. No cursor:pointer without click handler. Visually: fonts loaded, no default browser grays, charts have custom colors, badges are colored.

- [x] **[M1 Responsive Layout.** Add CSS media queries: at 1024px sidebar collapses to icon-only view; at 480px sidebar hides and hamburger menu appears. Table wrappers have `overflow-x: auto`. Cards and charts stack vertically on mobile. Modal and floating action bar adapt to narrow screens. Command palette adapts to mobile width. Date range picker stacks on mobile. Charts use `maintainAspectRatio: false` with container-driven sizing. **Why:** Per SPEC.md §Responsive requirement. tests.sh checks for media query presence and overflow-x. **Verify:** `bash tests.sh` — "Responsive Design" section all green. Playwright (if available): screenshots at 1280px and 480px show correct layout.

- [x] **[M1 Final QA + tests.sh pass.** Run `bash tests.sh` — all tests must be green (target: 29+ passed, 0 failed). Fix any failures. Walk through every checkbox in SPEC.md "Done When" section. Specifically verify: all 5 pages render with real data; date range picker on Trends affects all pages; period comparison shows deltas on Overview; category drill-down works; cardholder profile expansion works; full triage workflow (flag → acknowledge → investigate → flag); bulk actions; command palette navigates; keyboard shortcuts `g o/t/c/h/l` work; `?` shows help overlay; no dead buttons; no duplicate transaction IDs. Update `specs/STATUS.md` to mark all milestones complete. **Why:** Ship nothing broken. **Verify:** `bash tests.sh` exits 0. `output <promise>COMPLETE</promise>` only when every SPEC.md "Done When" checkbox passes.

---

## Discovered Issues

- `data/transactions.json` does not exist yet — server.js must not crash if the file is missing on startup; it should log a warning and serve empty data or exit gracefully with a clear message.
- `.venv/` exists but `paywithextend` may not be installed — M1 must check and install before using.
- DECLINED and NO_MATCH transactions have null `mcc`, `authBillingAmountCents`, `authedAt` fields — normalization must handle these with defaults (mcc='UNKNOWN', amount_cents=0, date=null or skip from date-based analytics).
- tests.sh already tests M3-M14 features — the builder must implement ALL API features (comparison, cardholder, enhanced categories, sparklines, cumulative) in M2-M4 before running tests.sh, or tests will fail.
- The tests.sh `urlencode` for cardholder name uses `import urllib.parse` — make sure `/api/cardholder/:name` properly handles URL-encoded names.
- tests.sh "Cardholder API" test imports `urllib.parse` without importing it — watch for this: the assert_python block uses `urllib.parse.quote` but only imports `urllib.request` and `json` at the top. The builder should verify this test actually passes.

## Notes for Builder

- **Python SDK:** `from extend import ExtendClient` + `BasicAuth` from `extend.auth`. All methods are async. Use `asyncio.run()`.
- **SDK method:** `client.transactions.get_transactions(page=X, per_page=25)` — not `client.get_transactions()`.
- **Pagination stop:** Stop when `len(page_transactions) < per_page`, NOT when count field is checked.
- **Response shape:** `response["report"]["transactions"]` — NOT `response["transactions"]`.
- **Overwrite:** Always open `data/transactions.json` with `'w'` mode — never append.
- **Node fetch:** Use Node 18+ built-in `fetch` for Extend API calls in server.js (receipt reminders). No axios.
- **triage.json:** Create with `{}` if not exists. Load on startup. Write-through on every triage action.
- **Outlier baseline:** Skip AMOUNT_OUTLIER if cardholder has < 5 transactions. Skip VELOCITY_SPIKE if cardholder has < 3 active days. Do NOT flag DECLINED transactions (amount_cents=0).
- **Static serve:** `app.use(express.static('public'))` — serves `public/index.html` at `/`.
- **Date filtering:** Compare transaction `date` field (ISO 8601 string) to `from`/`to` params using string comparison (`date >= from && date <= to`) — works correctly for ISO dates.
- **Env vars:** `process.env.EXTEND_API_KEY` and `process.env.EXTEND_API_SECRET` for receipt reminder calls from server.js.
- **run-ralph.sh orchestration:** The orchestration script runs planner → builder → tests.sh → reviewer. Builder picks the top unchecked item from this file, implements it, and marks it done.
- **One task at a time:** Mark a task `[x]` only after its verification commands pass.
