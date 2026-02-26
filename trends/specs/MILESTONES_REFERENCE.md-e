# Plan: Milestones and Validation Gates

Each milestone is sized to complete in 1-3 iterations. Do NOT skip ahead.
After completing a milestone, run its validation commands. If validation fails, fix before moving on.

---

## Milestone 1: Data Layer
**Goal:** Fetch real transactions from Extend API with pagination, save to disk.

- [ ] Create Python venv at `.venv/` if not present
- [ ] Install `paywithextend` SDK in venv
- [ ] Write `fetch-data.py`: fetch with pagination (see specs/ARCHITECTURE.md for pagination strategy)
- [ ] Ensure `fetch-data.py` OVERWRITES `data/transactions.json` on every run (never appends)
- [ ] Run `fetch-data.py` and verify `data/transactions.json` exists with 200-300 records
- [ ] Verify NO duplicate transaction IDs in the output file
- [ ] Log first transaction's keys to confirm schema (including mccGroup)

**Validation gate:**
```bash
.venv/bin/python3 fetch-data.py
python3 -c "
import json
d = json.load(open('data/transactions.json'))
ids = [t['id'] for t in d]
unique = set(ids)
print(f'Records: {len(d)}, Unique IDs: {len(unique)}')
assert len(ids) == len(unique), f'DUPLICATES FOUND'
assert 100 < len(d) < 2000, f'Expected 100-2000 records, got {len(d)}'
"
# Run a SECOND time to verify overwrite (not append)
.venv/bin/python3 fetch-data.py
python3 -c "
import json
d = json.load(open('data/transactions.json'))
ids = [t['id'] for t in d]
assert len(ids) == len(set(ids)), f'APPEND BUG: duplicates after re-run'
"
```

---

## Milestone 2: Server Core + Outlier Detection + Triage State
**Goal:** Express server with all original endpoints, outlier detection (6 rules), and triage state management.

- [ ] Create `package.json` with express dependency
- [ ] `npm install`
- [ ] Write `server.js`: load JSON, normalize to internal schema (see specs/ARCHITECTURE.md)
- [ ] Implement baseline computation: per-cardholder stats, per-category stats, per-cardholder-merchant sets
- [ ] Implement all 6 outlier rules with severity levels and context strings
- [ ] Implement triage state: load/create `data/triage.json`, merge triage_status onto transactions
- [ ] Implement `GET /api/summary` (with `by_triage_status` counts — WITHOUT sparklines or comparison for now)
- [ ] Implement `GET /api/transactions` with query params (status, rule, severity, search, page, limit, sort, order) — returns `counts` for all status buckets
- [ ] Implement `GET /api/trends` (with 7-day moving average — WITHOUT cumulative_cents for now)
- [ ] Implement `GET /api/categories` (top 10 by spend — WITHOUT sparkline, avg_cents, outlier_count for now)
- [ ] Implement `GET /api/top-spenders` (top 5 by spend)
- [ ] Implement `GET /api/distribution` (6 amount buckets)
- [ ] Implement `GET /api/day-of-week` (7-day averages)
- [ ] Implement `POST /api/actions/triage`, `POST /api/actions/remind`, `POST /api/actions/bulk`
- [ ] Implement `POST /api/refresh` (shells out to fetch-data.py, reloads data + baselines, preserves triage.json)
- [ ] `/api/transactions` sorted by date descending by default

**Validation gate:**
```bash
npm install
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/api/summary | python3 -m json.tool
curl -sf http://localhost:3000/api/trends | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d)>0; assert 'moving_avg_cents' in d[0]; print('OK')"
curl -sf http://localhost:3000/api/categories | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d)>0; assert 'pct_of_total' in d[0]; print('OK')"
curl -sf http://localhost:3000/api/distribution | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d)==6; print('OK')"
curl -sf http://localhost:3000/api/day-of-week | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d)==7; print('OK')"
curl -sf "http://localhost:3000/api/transactions?status=flagged&page=1&limit=5" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'counts' in d, 'Missing counts'
dates = [v['date'] for v in d['transactions']]
assert dates == sorted(dates, reverse=True), 'NOT sorted by date desc'
for t in d['transactions']:
    for o in t.get('outliers', []):
        assert 'context' in o, 'Missing context in outlier'
print('OK')
"
pkill -f "node server.js"
```

---

## Milestone 3: Date Range Filtering + Comparison API
**Goal:** All READ endpoints accept `from`/`to` date range params. New `/api/comparison` endpoint. Enhanced `/api/summary` with sparklines.

- [ ] Add `from`/`to` query param parsing to ALL READ endpoints
- [ ] Filter transactions by date before computing aggregates
- [ ] Implement `GET /api/comparison` endpoint (current vs previous period stats + deltas)
- [ ] Add `sparklines` field to `/api/summary` response (last 7 data points for each metric)
- [ ] Add `cumulative_cents` to `/api/trends` response
- [ ] Add `from`/`to` and `category` params to `/api/transactions`
- [ ] Verify: `/api/summary?from=2026-01-01&to=2026-01-31` returns only January data
- [ ] Verify: `/api/comparison` returns current/previous periods with percentage deltas

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Date range filtering
curl -sf "http://localhost:3000/api/summary?from=2026-01-01&to=2026-01-31" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'sparklines' in d, 'Missing sparklines'
assert 'spend' in d['sparklines'], 'Missing sparklines.spend'
print('Summary with date range: OK')
"
# Comparison endpoint
curl -sf "http://localhost:3000/api/comparison?from=2026-01-15&to=2026-02-15" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'current' in d, 'Missing current'
assert 'previous' in d, 'Missing previous'
assert 'deltas' in d, 'Missing deltas'
print('Comparison: OK')
"
# Trends with cumulative
curl -sf "http://localhost:3000/api/trends" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'cumulative_cents' in d[0], 'Missing cumulative_cents'
print('Trends cumulative: OK')
"
pkill -f "node server.js"
```

---

## Milestone 4: Cardholder API + Enhanced Categories
**Goal:** New `/api/cardholder/:name` endpoint. Enhanced categories endpoint with sparklines, avg, outlier count.

- [ ] Implement `GET /api/cardholder/:name` with full profile (spending_timeline, top_categories, outlier_transactions, missing_receipt_transactions)
- [ ] Enhance `GET /api/categories` with: `all=true` param, `sparkline`, `avg_cents`, `outlier_count` fields
- [ ] Add `outlier_count` and `top_category` fields to `/api/top-spenders`
- [ ] URL-encode cardholder names correctly in endpoint

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Get a cardholder name from top-spenders
CARDHOLDER=$(curl -sf http://localhost:3000/api/top-spenders | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['cardholder'])")
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CARDHOLDER'))")
curl -sf "http://localhost:3000/api/cardholder/$ENCODED" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'cardholder' in d, 'Missing cardholder'
assert 'spending_timeline' in d, 'Missing spending_timeline'
assert 'top_categories' in d, 'Missing top_categories'
assert 'outlier_transactions' in d, 'Missing outlier_transactions'
assert 'missing_receipt_transactions' in d, 'Missing missing_receipt_transactions'
print('Cardholder profile: OK')
"
# Enhanced categories
curl -sf "http://localhost:3000/api/categories?all=true" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert len(d) >= 5, f'Expected all categories, got {len(d)}'
assert 'sparkline' in d[0], 'Missing sparkline'
assert 'avg_cents' in d[0], 'Missing avg_cents'
assert 'outlier_count' in d[0], 'Missing outlier_count'
print('Enhanced categories: OK')
"
pkill -f "node server.js"
```

---

## Milestone 5: Client-Side Routing Shell
**Goal:** `public/index.html` with hash-based routing, sidebar navigation, and page skeletons.

- [ ] Create `public/index.html` with HTML skeleton: sidebar, header, main content area
- [ ] Implement hash-based routing (`#/overview`, `#/trends`, `#/categories`, `#/cardholders`, `#/outliers`)
- [ ] Default route (`/` or `#/`) redirects to `#/overview`
- [ ] Sidebar with FUNCTIONAL nav items linking to hash routes + active state
- [ ] Decorative nav items (Cards, Transactions, Receipts, Settings, Help) with `cursor: default`
- [ ] Dynamic header: page title changes per route, refresh timestamp placeholder
- [ ] Page transition skeleton: each route clears main content and renders a placeholder
- [ ] Browser back/forward works correctly
- [ ] Add Chart.js and chosen fonts via CDN

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/ | grep -q '<html'
curl -sf http://localhost:3000/ | python3 -c "
import sys
html = sys.stdin.read()
assert '#/overview' in html, 'Missing overview route'
assert '#/trends' in html, 'Missing trends route'
assert '#/categories' in html, 'Missing categories route'
assert '#/cardholders' in html, 'Missing cardholders route'
assert '#/outliers' in html, 'Missing outliers route'
assert 'hashchange' in html, 'Missing hashchange listener'
print('Routing shell: OK')
"
pkill -f "node server.js"
```

---

## Milestone 6: Overview Page
**Goal:** Fully functional Overview page with summary cards, charts, quick-view outlier table, and activity feed.

- [ ] Fetch `/api/summary` + `/api/comparison` and render 4 summary cards with sparklines and period deltas
- [ ] Render spend over time area chart with 7-day moving average (from `/api/trends`)
- [ ] Render category breakdown horizontal bar chart (from `/api/categories`)
- [ ] Render quick-view outlier table (latest 5 flagged, from `/api/transactions?status=flagged&limit=5`)
- [ ] "View all" link on outlier table navigates to `#/outliers`
- [ ] Render recent activity feed (last 10 transactions from `/api/transactions?status=all&limit=10`)

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshot at 1280px → screenshots/milestone6-overview.png
# Playwright DOM checks: 4 summary cards visible, charts rendered, outlier table has rows, activity feed has items
pkill -f "node server.js"
```

---

## Milestone 7: Trends Deep Dive Page
**Goal:** Trends page with date range picker, period comparison toggle, and all trend charts.

- [ ] Date range picker: preset buttons (7d, 30d, 90d, All) + custom date inputs
- [ ] Changing date range updates `appState.dateRange` and re-fetches all charts
- [ ] Period comparison toggle checkbox (updates `appState.comparison`)
- [ ] Spend over time chart (larger than overview) with moving average
- [ ] Daily transaction count chart
- [ ] Average transaction size over time chart
- [ ] Cumulative spend chart (running total from `/api/trends` `cumulative_cents`)
- [ ] Day-of-week heatmap (from `/api/day-of-week`)
- [ ] When comparison is on, charts show dual series (current vs previous)

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshot at 1280px → screenshots/milestone7-trends.png
# Playwright DOM checks: date picker visible, 5 chart sections rendered, preset buttons present
pkill -f "node server.js"
```

---

## Milestone 8: Categories Drill-Down Page
**Goal:** Categories page with full table, sparklines, and drill-down to transactions.

- [ ] Fetch `/api/categories?all=true` and render category bar chart (all categories)
- [ ] Render category table: name, total spend, count, % of total, avg transaction, outlier count, sparkline
- [ ] Click a category row to drill down — show filtered transactions inline or as a sub-view
- [ ] Drill-down fetches `/api/transactions?category=MCC_GROUP`
- [ ] Category sparklines render in the table rows

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshot at 1280px → screenshots/milestone8-categories.png
# Playwright DOM checks: category table has rows with sparklines, bar chart rendered
pkill -f "node server.js"
```

---

## Milestone 9: Cardholders Page
**Goal:** Cardholder table with expandable inline profiles.

- [ ] Fetch `/api/top-spenders` for initial cardholder list (or extend to all cardholders)
- [ ] Render cardholder table: Name, Total Spend, Transaction Count, Outlier Count, Top Category, Avg Transaction
- [ ] Search box filters cardholders by name
- [ ] Column sorting (click headers)
- [ ] Click row to expand inline profile — fetches `/api/cardholder/:name`
- [ ] Profile shows: spending timeline chart, top categories chart, outlier history list
- [ ] Quick action: "Send Receipt Reminders" button for cardholder's missing-receipt transactions

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshot at 1280px → screenshots/milestone9-cardholders.png
# Playwright DOM checks: cardholder table has rows, search input present
pkill -f "node server.js"
```

---

## Milestone 10: Outliers Page — Table + Triage
**Goal:** Full outlier triage page with tabs, filters, sortable table, detail modal, and actions.

- [ ] Status bucket tabs: Flagged | Acknowledged | Investigating | All Transactions (with counts)
- [ ] Inline filter row: Type dropdown, Severity dropdown, Search (debounced 300ms), Export CSV, Refresh Data
- [ ] Transaction table with checkbox + 6 data columns (Date, Merchant, Category, Card, Card User, Amount)
- [ ] Column sorting (click headers), severity badges, pagination (25 per page)
- [ ] Row click opens detail modal: full details, outlier context cards, triage actions
- [ ] Triage actions (Acknowledge, Investigate) with loading/success/error feedback
- [ ] Send Receipt Reminder in modal (conditional on receipt_missing)
- [ ] Triage state changes: transaction moves between tabs, counts update
- [ ] Checkbox "select all" in header, floating action bar for bulk actions
- [ ] Bulk actions: Send Reminders, Acknowledge, Investigate
- [ ] Export CSV exports current filtered view
- [ ] Refresh Data re-fetches from Extend API and reloads

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
FIRST_TXN=$(curl -sf "http://localhost:3000/api/transactions?status=flagged&limit=1" | python3 -c "import sys,json; print(json.load(sys.stdin)['transactions'][0]['id'])")
curl -sf -X POST http://localhost:3000/api/actions/triage -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$FIRST_TXN\",\"triage_status\":\"acknowledged\"}" | python3 -m json.tool
curl -sf "http://localhost:3000/api/transactions?status=acknowledged&limit=5" | python3 -c "
import sys, json; d = json.load(sys.stdin); assert d['total'] > 0
"
# Reset
curl -sf -X POST http://localhost:3000/api/actions/triage -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$FIRST_TXN\",\"triage_status\":\"flagged\"}"
# Playwright screenshot → screenshots/milestone10-outliers.png
# Playwright DOM checks: tabs with counts, table rows visible (≥5), filters present, pagination present
pkill -f "node server.js"
```

---

## Milestone 11: Command Palette + Keyboard Shortcuts
**Goal:** Cmd+K command palette and full keyboard navigation.

- [ ] `Cmd+K` / `Ctrl+K` opens command palette overlay
- [ ] Command palette searches: pages (Overview, Trends, etc.), transactions (by merchant/cardholder), actions (Refresh Data, Export CSV)
- [ ] Results update as you type (debounced 200ms)
- [ ] Arrow keys navigate results, Enter selects, Escape closes
- [ ] `g o/t/c/h/l` keyboard shortcuts for page navigation
- [ ] `j`/`k` navigate table rows on Outliers page (and any table-heavy page)
- [ ] `Enter` opens detail modal for selected row
- [ ] `Escape` closes modal or command palette
- [ ] `?` opens keyboard shortcut help overlay
- [ ] Shortcut hints shown in sidebar nav items (e.g., "G O" next to Overview)

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/ | python3 -c "
import sys
html = sys.stdin.read()
assert 'Cmd+K' in html or 'cmd+k' in html.lower() or 'ctrl+k' in html.lower(), 'Missing command palette trigger'
assert 'command-palette' in html or 'commandPalette' in html, 'Missing command palette component'
assert 'shortcut' in html.lower(), 'Missing keyboard shortcut references'
print('Command palette + shortcuts: OK')
"
pkill -f "node server.js"
```

---

## Milestone 12: UI Design + Polish
**Goal:** Apply a distinctive, design-forward visual system. Follow the creative brief in ARCHITECTURE.md.

- [ ] Choose and implement a cohesive color palette, typography (Google Fonts CDN), and spacing system
- [ ] Style sidebar: brand mark, user profile area (initials "JB", role "Card Manager"), active indicator
- [ ] Style header: dynamic title, refresh timestamp, active date range indicator, decorative elements
- [ ] Style summary cards, charts, status tabs, inline filters
- [ ] Style triage table: row borders, hover states, right-aligned amounts, severity badges
- [ ] Style detail modal, floating action bar, pagination
- [ ] Style command palette and keyboard shortcut overlay
- [ ] Customize Chart.js: tooltip design, gridlines, axis labels, chart color palette matching theme
- [ ] Toast notifications: styled, non-blocking, auto-dismiss 3s, stack from bottom-right
- [ ] Ensure decorative elements have `cursor: default`, NO hover effects
- [ ] Loading states: skeleton loaders for charts and tables
- [ ] Empty states: no outliers, no search results, empty tabs
- [ ] Error states: user-friendly messages with retry
- [ ] Smooth page transitions (CSS fade or slide)

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshot at 1280px → screenshots/milestone12-styled.png
# Playwright DOM checks: sidebar present, summary cards have content, table rows visible (≥5), charts rendered
# Visual quality check: fonts loaded, no default browser styles visible
pkill -f "node server.js"
```

---

## Milestone 13: Responsive Layout
**Goal:** Works well at 1920px, 1280px, 768px, and 480px.

- [ ] Sidebar collapses to icons at 1024px (or 768px — pick one threshold)
- [ ] Sidebar hides at 480px, hamburger menu appears
- [ ] Table scrolls horizontally on small screens
- [ ] Cards and charts stack vertically on mobile
- [ ] Modal and floating action bar adapt to narrow screens
- [ ] Command palette adapts to mobile width
- [ ] Charts resize with `maintainAspectRatio: false`
- [ ] Date range picker stacks on mobile

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshots at 1920px, 1280px, 768px, 480px → screenshots/milestone13-*.png
# Playwright DOM checks at each breakpoint: table rows visible, no content clipped, cards stack on mobile
pkill -f "node server.js"
```

---

## Milestone 14: Final QA
**Goal:** End-to-end verification of every item in specs/SPEC.md "Done When".

- [ ] Walk through every checkbox in specs/SPEC.md "Done When" section
- [ ] Fix anything that doesn't pass
- [ ] Verify all 5 pages load and render correctly
- [ ] Verify date range picker on Trends page affects all pages
- [ ] Verify period comparison toggle works on Overview + Trends
- [ ] Verify cardholder profile expansion works
- [ ] Verify category drill-down works
- [ ] Verify full triage workflow: flag → acknowledge → investigate → flag
- [ ] Verify bulk actions work
- [ ] Verify command palette: navigate to pages, search transactions
- [ ] Verify keyboard shortcuts: `g o/t/c/h/l`, `j/k`, `Enter`, `?`
- [ ] Verify no dead buttons (every cursor:pointer has a handler)
- [ ] Verify no duplicate transaction IDs
- [ ] Run `bash tests.sh` — all green
- [ ] Final screenshots at 1280px, 768px, 480px
- [ ] Update specs/STATUS.md with final state

**Validation gate:**
Run every check from specs/SPEC.md "Done When". Take screenshots at 1280px. Use Playwright to verify: all 5 pages render, table shows ≥5 rows with non-zero height, all summary cards have numeric content, charts render, modal opens on row click, outlier context card visible, command palette opens on Cmd+K. If ALL pass, output `<promise>COMPLETE</promise>`.

---

## Notes

- **One milestone at a time.** Don't start N+1 until N's validation gate passes.
- **If validation fails:** Fix it now. Don't mark complete.
- **Screenshots go in `screenshots/` directory.** Never save to project root.
- **Date range is global.** Once implemented in Milestone 3 (server) and Milestone 7 (UI), it must work across all pages.
- **The creative brief gives freedom.** Don't use default Chart.js colors or Bootstrap gray. Make it look like a real product.
