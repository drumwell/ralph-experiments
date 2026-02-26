# Plan: Milestones and Validation Gates

Each milestone is sized to complete in 1-3 iterations. Do NOT skip ahead.
After completing a milestone, run its validation commands. If validation fails, fix before moving on.
Mark milestones with `[x]` when ALL validation passes.

---

## Milestone 1: Data Layer
**Goal:** Fetch real transactions from Extend API with pagination, save to disk.

- [x] Create Python venv at `.venv/` if not present
- [x] Install `paywithextend` SDK in venv
- [x] Write `fetch-data.py`: fetch with pagination (see specs/ARCHITECTURE.md for pagination strategy)
- [x] Ensure `fetch-data.py` OVERWRITES `data/transactions.json` on every run (never appends)
- [x] Run `fetch-data.py` and verify `data/transactions.json` exists with 200-300 records
- [x] Verify NO duplicate transaction IDs in the output file
- [x] Log first transaction's keys to confirm schema

**Validation gate:**
```bash
.venv/bin/python3 fetch-data.py
python3 -c "
import json
d = json.load(open('data/transactions.json'))
ids = [t['id'] for t in d]
unique = set(ids)
print(f'Records: {len(d)}, Unique IDs: {len(unique)}')
assert len(ids) == len(unique), f'DUPLICATES FOUND: {len(d)} records but {len(unique)} unique IDs'
assert 100 < len(d) < 2000, f'Expected 100-2000 records, got {len(d)}'
"
# Run it a SECOND time to verify overwrite (not append)
.venv/bin/python3 fetch-data.py
python3 -c "
import json
d = json.load(open('data/transactions.json'))
ids = [t['id'] for t in d]
unique = set(ids)
print(f'After 2nd run — Records: {len(d)}, Unique IDs: {len(unique)}')
assert len(ids) == len(unique), f'APPEND BUG: duplicates after re-run ({len(d)} records, {len(unique)} unique)'
"
```
**Decision notes:** If API returns different field names than expected in specs/ARCHITECTURE.md, update specs/ARCHITECTURE.md's "Extend:" comments but keep internal field names unchanged.

---

## Milestone 2: Express Server + Violation Engine
**Goal:** API server that loads data, normalizes it, detects violations, and serves endpoints.

- [x] Create `package.json` with express dependency
- [x] `npm install`
- [x] Write `server.js`: load JSON, normalize to internal schema (see specs/ARCHITECTURE.md)
- [x] Implement all 5 violation rules with severity levels
- [x] Implement endpoints: `/api/summary`, `/api/violations` (with query params), `/api/trends`
- [x] Implement endpoints: `/api/violation-trends`, `/api/top-offenders`
- [x] Implement `POST /api/refresh` (shells out to fetch-data.py, reloads data)
- [x] `/api/violations` must return results sorted by date descending by default

**Validation gate:**
```bash
npm install
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/api/summary | python3 -m json.tool
curl -sf "http://localhost:3000/api/violations?page=1&limit=5" | python3 -m json.tool
curl -sf http://localhost:3000/api/trends | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Trend days: {len(d)}')"
curl -sf http://localhost:3000/api/violation-trends | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Violation trend days: {len(d)}')"
curl -sf http://localhost:3000/api/top-offenders | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Top offenders: {len(d)}')"
# Verify sort order: first result should have a later date than last result
curl -sf "http://localhost:3000/api/violations?page=1&limit=5" | python3 -c "
import sys, json
d = json.load(sys.stdin)
dates = [v['date'] for v in d['violations']]
print(f'Date order: {dates[0]} ... {dates[-1]}')
assert dates == sorted(dates, reverse=True), 'NOT sorted by date descending'
print('Sort order: OK (date desc)')
"
pkill -f "node server.js"
```
**Decision notes:** Normalization handles missing fields gracefully (default to empty string / 0 / false). Never crash on unexpected data.

---

## Milestone 3: Dashboard Foundation
**Goal:** Basic HTML dashboard with summary cards and charts. Not styled to match Extend yet.

- [x] Create `public/index.html` with HTML skeleton: sidebar placeholder, header, main content area
- [x] Add Chart.js via CDN
- [x] Fetch `/api/summary` and render 4 summary cards (total spend, txn count, violations, compliance rate)
- [x] Render doughnut chart (violations by rule type)
- [x] Render bar chart (daily spend trend)
- [x] Render line chart (violation trends over time)
- [x] Render "Top Offenders" card

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/ | head -5  # Should return HTML
# Visual check: use Playwright to screenshot at 1280px → save to screenshots/milestone3-dashboard.png
# Confirm: 4 summary cards visible, 3 charts render with data, top offenders card shows names
pkill -f "node server.js"
```
**Decision notes:** Get functionality working first. Styling comes in Milestone 5. Use basic CSS grid/flexbox for layout. Charts should have real data, not placeholders.

---

## Milestone 4: Violations Table + Interactivity
**Goal:** Full violations table with filtering, search, pagination, sorting, drill-down, and CSV export.

- [x] Render violations table: Date, Merchant, Card, Card User, Receipts, Amount columns
- [x] Table sorted by date descending by default
- [x] Add clickable column headers that toggle sort direction (with visual sort indicator)
- [x] Add severity badges to each row (colored by HIGH/MEDIUM/LOW)
- [x] Add filter dropdowns above table: by rule type, by severity
- [x] Add search box: filters by merchant, cardholder, card name, amount
- [x] Add pagination controls (25 rows per page, prev/next buttons, page indicator)
- [x] Add click handler on rows: opens detail modal showing all transaction fields + violations
- [x] Add "Download CSV" button: exports current filtered view
- [x] Wire up `/api/violations` query params to filter controls

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# API-level validation
curl -sf "http://localhost:3000/api/violations?rule=WEEKEND_SPEND&page=1&limit=5" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Filtered: {d[\"total\"]} weekend violations')"
curl -sf "http://localhost:3000/api/violations?severity=HIGH&page=1&limit=5" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'High severity: {d[\"total\"]}')"
curl -sf "http://localhost:3000/api/violations?search=amazon&page=1&limit=5" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Search results: {d[\"total\"]}')"
# Visual check: Playwright screenshot at 1280px → save to screenshots/milestone4-table.png
# Confirm: table visible, sorted by date desc, filter dropdowns present, pagination controls visible
pkill -f "node server.js"
```
**Decision notes:** The table fetches from the API with query params. Filtering happens server-side. Search is case-insensitive substring match. Modal is a CSS overlay, not a new page.

---

## Milestone 5: Extend UI Design Match
**Goal:** Restyle everything to match Extend's production UI. See specs/ARCHITECTURE.md "UI Design" section for exact specs.

- [x] Implement sidebar: 240px, light gray, icon+text nav items, teal active indicator, collapsible sections
- [x] Implement top header: logo area, "Card Transactions" title, decorative elements (see specs/ARCHITECTURE.md "Cosmetic vs Functional")
- [x] Implement search/filter bar: search input, filter/download icons
- [x] Apply Extend color palette everywhere (see specs/ARCHITECTURE.md)
- [x] Style summary cards: white background, subtle shadow, proper typography
- [x] Style charts: clean borders, proper colors, tooltips
- [x] Style violations table: row borders, hover states, right-aligned amounts, status badges, receipt icons
- [x] Style detail modal: clean layout, severity badges, close button
- [x] Style pagination: clean prev/next buttons, page indicator
- [x] Ensure decorative elements do NOT have cursor:pointer or hover effects (see specs/ARCHITECTURE.md "Cosmetic vs Functional")

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Take Playwright screenshot at 1280px width → save to screenshots/milestone5-styled.png
# Compare against specs/ARCHITECTURE.md "UI Design" section:
# ✓ Light theme (white background)
# ✓ Sidebar: 240px, light gray, teal active border
# ✓ Header: logo, title, decorative elements styled as static
# ✓ Color palette matches specs/ARCHITECTURE.md
# ✓ Table columns in correct order (Date, Merchant, Card, Card User, Receipts, Amount)
# ✓ Status badges (Pending/Cleared/Declined/Reversal)
# ✓ Amounts right-aligned, negatives in red
# ✓ No elements that look clickable but do nothing
pkill -f "node server.js"
```
**Decision notes:** Reference the "UI Design" section of specs/ARCHITECTURE.md for exact colors, component specs, sidebar structure, table columns. If a UI design constraint conflicts with a feature requirement in specs/SPEC.md, specs/SPEC.md wins for features, specs/ARCHITECTURE.md wins for visual design.

---

## Milestone 6: Data Refresh + Polish
**Goal:** Refresh button works, edge cases handled, UI polish.

- [x] Wire "Refresh Data" button to `POST /api/refresh` → show loading state → reload all data in UI
- [x] Handle empty states: no violations message, no data message, loading spinners
- [x] Handle error states: API errors show user-friendly messages, not raw JSON
- [x] Add tooltips to charts (hover shows exact values)
- [x] Format all amounts as USD ($X,XXX.XX) and dates as locale strings
- [x] Ensure all interactive elements have hover/active states (but NOT decorative elements)
- [x] Verify refresh does NOT create duplicate records (re-run fetch-data.py and check)

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Test refresh endpoint
curl -sf -X POST http://localhost:3000/api/refresh | python3 -m json.tool
# Verify no duplicates after refresh
python3 -c "
import json
d = json.load(open('data/transactions.json'))
ids = [t['id'] for t in d]
assert len(ids) == len(set(ids)), f'DUPLICATES after refresh: {len(ids)} records, {len(set(ids))} unique'
print(f'Post-refresh: {len(ids)} records, 0 duplicates')
"
# Visual check: Playwright screenshot → save to screenshots/milestone6-polish.png
# Confirm: amounts formatted as USD, dates readable, hover states visible
pkill -f "node server.js"
```

---

## Milestone 7: Responsive + Final Verification
**Goal:** Works on tablet and mobile. Final visual QA.

- [x] Responsive: sidebar collapses to icons at 768px
- [x] Responsive: sidebar hides at 480px, hamburger menu appears
- [x] Responsive: table scrolls horizontally on small screens
- [x] Responsive: cards stack vertically on mobile
- [x] Responsive: modal adapts to screen width

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshots at 3 widths (save to screenshots/ directory):
# 1. screenshots/milestone7-desktop-1280px.png — full layout, all elements visible
# 2. screenshots/milestone7-tablet-768px.png — sidebar collapsed to icons, content fills width
# 3. screenshots/milestone7-mobile-480px.png — sidebar hidden, cards stacked, table scrollable
# Each screenshot must show NO overflow, NO broken layout, NO cut-off text
pkill -f "node server.js"
```

---

## Milestone 8: Comprehensive QA
**Goal:** End-to-end verification of every feature in specs/SPEC.md's "Done When" checklist.

- [x] Walk through every item in specs/SPEC.md "Done When" section
- [x] Fix anything that doesn't pass
- [x] Take final verification screenshots at all 3 widths (save to screenshots/)
- [x] Verify no duplicate transaction IDs in data/transactions.json
- [x] Verify no dead buttons (every element with cursor:pointer has a handler)
- [x] Update specs/STATUS.md with final state, decisions made, known limitations

**Validation gate:**
Run every `curl` command from specs/SPEC.md's "Done When" checklist. Take Playwright screenshots at 1280px, 768px, 480px and save to `screenshots/`. If ALL pass, output `<promise>COMPLETE</promise>`.

---

## Notes

- **One milestone at a time.** Don't start Milestone N+1 until Milestone N's validation gate passes.
- **If validation fails:** Fix the issue within the current milestone. Do not mark it complete.
- **If you discover a bug from a previous milestone:** Fix it now, re-run that milestone's validation, then continue.
- **Update specs/STATUS.md** after completing each milestone with what was done and any decisions made.
- **Screenshots go in `screenshots/` directory.** Never save screenshots to the project root.
