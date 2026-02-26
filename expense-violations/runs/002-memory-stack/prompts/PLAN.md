# Plan: Milestones and Validation Gates

Each milestone is sized to complete in 1-3 iterations. Do NOT skip ahead.
After completing a milestone, run its validation commands. If validation fails, fix before moving on.
Mark milestones with `[x]` when ALL validation passes.

---

## Milestone 1: Data Layer
**Goal:** Fetch real transactions from Extend API with pagination, save to disk.

- [ ] Create Python venv at `.venv/` if not present
- [ ] Install `paywithextend` SDK in venv
- [ ] Write `fetch-data.py`: fetch with pagination (see specs/ARCHITECTURE.md for pagination strategy)
- [ ] Run `fetch-data.py` and verify `data/transactions.json` exists with 200-300 records
- [ ] Log first transaction's keys to confirm schema

**Validation gate:**
```bash
.venv/bin/python3 fetch-data.py
python3 -c "import json; d=json.load(open('data/transactions.json')); print(f'Records: {len(d)}'); assert 100 < len(d) < 500, f'Expected 100-500 records, got {len(d)}'"
```
**Decision notes:** If API returns different field names than expected in specs/ARCHITECTURE.md, update specs/ARCHITECTURE.md's "Extend:" comments but keep internal field names unchanged.

---

## Milestone 2: Express Server + Violation Engine
**Goal:** API server that loads data, normalizes it, detects violations, and serves endpoints.

- [ ] Create `package.json` with express dependency
- [ ] `npm install`
- [ ] Write `server.js`: load JSON, normalize to internal schema (see specs/ARCHITECTURE.md)
- [ ] Implement all 5 violation rules with severity levels
- [ ] Implement endpoints: `/api/summary`, `/api/violations` (with query params), `/api/trends`
- [ ] Implement endpoints: `/api/violation-trends`, `/api/top-offenders`
- [ ] Implement `POST /api/refresh` (shells out to fetch-data.py, reloads data)

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
pkill -f "node server.js"
```
**Decision notes:** Normalization handles missing fields gracefully (default to empty string / 0 / false). Never crash on unexpected data.

---

## Milestone 3: Dashboard Foundation
**Goal:** Basic HTML dashboard with summary cards and charts. Not styled to match Extend yet.

- [ ] Create `public/index.html` with HTML skeleton: sidebar placeholder, header, main content area
- [ ] Add Chart.js via CDN
- [ ] Fetch `/api/summary` and render 4 summary cards (total spend, txn count, violations, compliance rate)
- [ ] Render doughnut chart (violations by rule type)
- [ ] Render bar chart (daily spend trend)
- [ ] Render line chart (violation trends over time)
- [ ] Render "Top Offenders" card

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/ | head -5  # Should return HTML
# Visual check: use Playwright to screenshot at 1280px
# Confirm: 4 summary cards visible, 3 charts render with data, top offenders card shows names
pkill -f "node server.js"
```
**Decision notes:** Get functionality working first. Styling comes in Milestone 5. Use basic CSS grid/flexbox for layout. Charts should have real data, not placeholders.

---

## Milestone 4: Violations Table + Interactivity
**Goal:** Full violations table with filtering, search, pagination, drill-down, and CSV export.

- [ ] Render violations table: Date, Merchant, Card, Card User, Receipts, Amount columns
- [ ] Add severity badges to each row (colored by HIGH/MEDIUM/LOW)
- [ ] Add filter dropdowns above table: by rule type, by severity
- [ ] Add search box: filters by merchant, cardholder, card name, amount
- [ ] Add pagination controls (25 rows per page, prev/next buttons, page indicator)
- [ ] Add click handler on rows: opens detail modal showing all transaction fields + violations
- [ ] Add "Download CSV" button: exports current filtered view
- [ ] Wire up `/api/violations` query params to filter controls

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# API-level validation
curl -sf "http://localhost:3000/api/violations?rule=WEEKEND_SPEND&page=1&limit=5" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Filtered: {d[\"total\"]} weekend violations')"
curl -sf "http://localhost:3000/api/violations?severity=HIGH&page=1&limit=5" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'High severity: {d[\"total\"]}')"
curl -sf "http://localhost:3000/api/violations?search=amazon&page=1&limit=5" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Search results: {d[\"total\"]}')"
# Visual check: Playwright screenshot at 1280px
# Confirm: table visible, filter dropdowns present, pagination controls visible
pkill -f "node server.js"
```
**Decision notes:** The table fetches from the API with query params. Filtering happens server-side. Search is case-insensitive substring match. Modal is a CSS overlay, not a new page.

---

## Milestone 5: Extend UI Design Match
**Goal:** Restyle everything to match Extend's production UI. See specs/ARCHITECTURE.md for exact specs.

- [ ] Implement sidebar: 240px, light gray, icon+text nav items, teal active indicator, collapsible sections
- [ ] Implement top header: logo area, "Card Transactions" title, "Create New +" button, search, user avatar
- [ ] Implement search/filter bar: date picker display, search input, filter/download icons
- [ ] Apply Extend color palette everywhere (see specs/ARCHITECTURE.md)
- [ ] Style summary cards: white background, subtle shadow, proper typography
- [ ] Style charts: clean borders, proper colors, tooltips
- [ ] Style violations table: row borders, hover states, right-aligned amounts, status badges, receipt icons
- [ ] Style detail modal: clean layout, severity badges, close button
- [ ] Style pagination: clean prev/next buttons, page indicator

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Take Playwright screenshot at 1280px width
# Compare against specs/ARCHITECTURE.md specs:
# ✓ Light theme (white background)
# ✓ Sidebar: 240px, light gray, teal active border
# ✓ Header: logo, title, create button, avatar
# ✓ Color palette matches specs/ARCHITECTURE.md
# ✓ Table columns in correct order (Date, Merchant, Card, Card User, Receipts, Amount)
# ✓ Status badges (Pending/Cleared/Declined/Reversal)
# ✓ Amounts right-aligned, negatives in red
pkill -f "node server.js"
```
**Decision notes:** Reference the "UI Design" section of specs/ARCHITECTURE.md for exact colors, component specs, sidebar structure, table columns. If a UI design constraint conflicts with a feature requirement in specs/SPEC.md, specs/SPEC.md wins for features, specs/ARCHITECTURE.md wins for visual design.

---

## Milestone 6: Data Refresh + Polish
**Goal:** Refresh button works, edge cases handled, UI polish.

- [ ] Wire "Refresh Data" button to `POST /api/refresh` → show loading state → reload all data in UI
- [ ] Handle empty states: no violations message, no data message, loading spinners
- [ ] Handle error states: API errors show user-friendly messages, not raw JSON
- [ ] Add tooltips to charts (hover shows exact values)
- [ ] Format all amounts as USD ($X,XXX.XX) and dates as locale strings
- [ ] Ensure all interactive elements have hover/active states

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Test refresh endpoint
curl -sf -X POST http://localhost:3000/api/refresh | python3 -m json.tool
# Visual check: Playwright screenshot
# Confirm: amounts formatted as USD, dates readable, hover states visible
pkill -f "node server.js"
```

---

## Milestone 7: Responsive + Final Verification
**Goal:** Works on tablet and mobile. Final visual QA.

- [ ] Responsive: sidebar collapses to icons at 768px
- [ ] Responsive: sidebar hides at 480px, hamburger menu appears
- [ ] Responsive: table scrolls horizontally on small screens
- [ ] Responsive: cards stack vertically on mobile
- [ ] Responsive: modal adapts to screen width

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshots at 3 widths:
# 1. 1280px (desktop) — full layout, all elements visible
# 2. 768px (tablet) — sidebar collapsed to icons, content fills width
# 3. 480px (mobile) — sidebar hidden, cards stacked, table scrollable
# Each screenshot must show NO overflow, NO broken layout, NO cut-off text
pkill -f "node server.js"
```

---

## Milestone 8: Comprehensive QA
**Goal:** End-to-end verification of every feature in specs/SPEC.md's "Done When" checklist.

- [ ] Walk through every item in specs/SPEC.md "Done When" section
- [ ] Fix anything that doesn't pass
- [ ] Take final verification screenshots at all 3 widths
- [ ] Update specs/STATUS.md with final state, decisions made, known limitations

**Validation gate:**
Run every `curl` command from specs/SPEC.md's "Done When" checklist. Take Playwright screenshots at 1280px, 768px, 480px. If ALL pass, output `<promise>COMPLETE</promise>`.

---

## Notes

- **One milestone at a time.** Don't start Milestone N+1 until Milestone N's validation gate passes.
- **If validation fails:** Fix the issue within the current milestone. Do not mark it complete.
- **If you discover a bug from a previous milestone:** Fix it now, re-run that milestone's validation, then continue.
- **Update specs/STATUS.md** after completing each milestone with what was done and any decisions made.
