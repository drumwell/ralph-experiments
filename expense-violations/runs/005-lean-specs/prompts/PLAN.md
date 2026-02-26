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
- [ ] Log first transaction's keys to confirm schema

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

## Milestone 2: Server + Violations + Review State
**Goal:** API server that loads data, normalizes it, detects violations, manages review state, and serves all endpoints.

- [ ] Create `package.json` with express dependency
- [ ] `npm install`
- [ ] Write `server.js`: load JSON, normalize to internal schema (see specs/ARCHITECTURE.md)
- [ ] Implement all 5 violation rules with severity levels
- [ ] Implement review state: load/create `data/reviews.json`, merge review_status onto transactions
- [ ] Implement `GET /api/summary` (with `by_review_status` counts)
- [ ] Implement `GET /api/transactions` with query params (status, rule, severity, search, page, limit, sort, order) — returns `counts` for all status buckets
- [ ] Implement `GET /api/trends` and `GET /api/top-offenders`
- [ ] Implement `POST /api/actions/review`, `POST /api/actions/remind`, `POST /api/actions/bulk`
- [ ] Implement `POST /api/refresh` (shells out to fetch-data.py, reloads data, preserves reviews.json)
- [ ] `/api/transactions` sorted by date descending by default

**Validation gate:**
```bash
npm install
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/api/summary | python3 -m json.tool
curl -sf "http://localhost:3000/api/transactions?status=flagged&page=1&limit=5" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert 'counts' in d, 'Missing counts'
dates = [v['date'] for v in d['transactions']]
assert dates == sorted(dates, reverse=True), 'NOT sorted by date desc'
print('OK')
"
curl -sf -X POST http://localhost:3000/api/actions/review -H 'Content-Type: application/json' \
  -d '{\"transaction_id\":\"TEST_NONEXISTENT\",\"review_status\":\"approved\"}' | python3 -m json.tool
pkill -f "node server.js"
```

---

## Milestone 3: Dashboard Foundation + Triage Table
**Goal:** HTML dashboard with summary cards, charts, and the triage table with status bucket tabs.

- [ ] Create `public/index.html` with HTML skeleton: sidebar placeholder, header, main content area
- [ ] Add Chart.js via CDN
- [ ] Fetch `/api/summary` and render 4 summary cards
- [ ] Render doughnut chart (violations by rule type) and bar chart (daily spend trend)
- [ ] Render "Top Offenders" card
- [ ] Render status bucket tabs: Flagged | Under Review | Approved | All Transactions
- [ ] Render inline filters: rule dropdown, severity dropdown, search input, Export CSV, Refresh Data
- [ ] Render triage table with checkbox column + 6 data columns
- [ ] Table sorted by date descending, clickable column headers toggle sort
- [ ] Severity badges on flagged rows
- [ ] Pagination: 25 rows per page with prev/next
- [ ] Tabs and inline filters work correctly

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
curl -sf http://localhost:3000/ | head -5
# Playwright screenshot at 1280px → screenshots/milestone3-dashboard.png
pkill -f "node server.js"
```

---

## Milestone 4: Actions + Detail Modal
**Goal:** Detail modal with review actions, receipt reminders, follow-up drafts. Bulk actions from table.

- [ ] Click handler on table rows opens detail modal with all transaction fields + violations
- [ ] Detail modal: "Mark Under Review" and "Approve" buttons with loading/success/error feedback
- [ ] Detail modal: "Send Receipt Reminder" button (only for receipt_missing transactions)
- [ ] Detail modal: "Draft Follow-Up" button with templated copyable message
- [ ] Review status changes visible: transaction moves between tabs, counts update
- [ ] Checkbox column with "select all on page" header checkbox
- [ ] Selecting rows shows floating action bar with bulk actions
- [ ] Bulk actions (Send Reminders, Approve, Mark Under Review) work and reload table
- [ ] "Download CSV" exports current filtered view

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
FIRST_TXN=$(curl -sf "http://localhost:3000/api/transactions?status=flagged&limit=1" | python3 -c "import sys,json; print(json.load(sys.stdin)['transactions'][0]['id'])")
curl -sf -X POST http://localhost:3000/api/actions/review -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$FIRST_TXN\",\"review_status\":\"approved\"}" | python3 -m json.tool
curl -sf "http://localhost:3000/api/transactions?status=approved&limit=5" | python3 -c "
import sys, json; d = json.load(sys.stdin); assert d['total'] > 0
"
# Reset
curl -sf -X POST http://localhost:3000/api/actions/review -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$FIRST_TXN\",\"review_status\":\"flagged\"}"
# Playwright screenshot → screenshots/milestone4-actions.png
pkill -f "node server.js"
```

---

## Milestone 5: Extend UI Design Match
**Goal:** Restyle everything to match Extend's production UI. See specs/ARCHITECTURE.md "UI Design" section.

- [ ] Implement sidebar per ARCHITECTURE.md (240px, collapsible sections, teal active indicator)
- [ ] Implement top header per ARCHITECTURE.md (logo, title, decorative elements)
- [ ] Apply Extend color palette everywhere
- [ ] Style summary cards, charts, status tabs, inline filters
- [ ] Style triage table: row borders, hover states, right-aligned amounts, status badges, receipt icons
- [ ] Style detail modal, floating action bar, pagination
- [ ] Ensure decorative elements do NOT have cursor:pointer or hover effects

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshot at 1280px → screenshots/milestone5-styled.png
pkill -f "node server.js"
```

---

## Milestone 6: Polish + Edge Cases
**Goal:** Loading states, empty states, error handling, formatting.

- [ ] Loading states: spinners for cards, charts, table, action buttons
- [ ] Empty states: no violations, no search results, empty tabs
- [ ] Error states: user-friendly messages
- [ ] Format amounts as USD, dates as locale strings
- [ ] Verify refresh preserves review state and doesn't create duplicates
- [ ] Action button feedback: loading, success, error with auto-dismiss

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Test refresh preserves reviews + no duplicates
FIRST_TXN=$(curl -sf "http://localhost:3000/api/transactions?status=flagged&limit=1" | python3 -c "import sys,json; print(json.load(sys.stdin)['transactions'][0]['id'])")
curl -sf -X POST http://localhost:3000/api/actions/review -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$FIRST_TXN\",\"review_status\":\"approved\"}"
curl -sf -X POST http://localhost:3000/api/refresh | python3 -m json.tool
curl -sf "http://localhost:3000/api/transactions?status=approved&limit=5" | python3 -c "
import sys, json; d = json.load(sys.stdin); assert d['total'] > 0, 'Review state lost!'
"
curl -sf -X POST http://localhost:3000/api/actions/review -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$FIRST_TXN\",\"review_status\":\"flagged\"}"
python3 -c "
import json; d = json.load(open('data/transactions.json'))
assert len(d) == len(set(t['id'] for t in d)), 'DUPLICATES after refresh'
"
pkill -f "node server.js"
```

---

## Milestone 7: Responsive
**Goal:** Works on tablet and mobile.

- [ ] Sidebar collapses to icons at 768px
- [ ] Sidebar hides at 480px, hamburger menu appears
- [ ] Table scrolls horizontally on small screens
- [ ] Cards stack vertically on mobile
- [ ] Modal and floating action bar adapt to narrow screens

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshots at 1280px, 768px, 480px → screenshots/milestone7-*.png
pkill -f "node server.js"
```

---

## Milestone 8: Final QA
**Goal:** End-to-end verification of specs/SPEC.md "Done When".

- [ ] Walk through every item in specs/SPEC.md "Done When"
- [ ] Fix anything that doesn't pass
- [ ] Final screenshots at 1280px, 768px, 480px
- [ ] Verify no duplicate transaction IDs, no dead buttons, full review workflow, bulk actions
- [ ] Update specs/STATUS.md with final state

**Validation gate:**
Run every check from specs/SPEC.md "Done When". Take screenshots. If ALL pass, output `<promise>COMPLETE</promise>`.

---

## Notes

- **One milestone at a time.** Don't start N+1 until N's validation gate passes.
- **If validation fails:** Fix it now. Don't mark complete.
- **Screenshots go in `screenshots/` directory.** Never save to project root.
