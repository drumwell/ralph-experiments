# Plan: Milestones and Validation Gates

Each milestone is sized to complete in 1-3 iterations. Do NOT skip ahead.
After completing a milestone, run its validation commands. If validation fails, fix before moving on.

---

## Milestone 1: Data Layer ✅ COMPLETE
## Milestone 2: Server + Violations + Review State ✅ COMPLETE
## Milestone 3: Dashboard Foundation + Triage Table ✅ COMPLETE
## Milestone 4: Actions + Detail Modal ✅ COMPLETE

---

## Milestone 5: Extend UI Design Match
**Goal:** Restyle everything to match Extend's production UI. See specs/ARCHITECTURE.md "UI Design" section for exact specs.

- [x] Implement sidebar: 240px, light gray, icon+text nav items, teal active indicator, collapsible sections (see specs/ARCHITECTURE.md "Sidebar Navigation")
- [x] Implement top header: logo area, "Card Transactions" title, decorative elements (see specs/ARCHITECTURE.md "Cosmetic vs Functional")
- [x] Apply Extend color palette everywhere (see specs/ARCHITECTURE.md)
- [x] Style summary cards: white background, subtle shadow, proper typography
- [x] Style charts: clean borders, proper colors, tooltips with formatted values
- [x] Style status bucket tabs: teal bottom border on active tab, count badges, clean typography
- [x] Style inline filters: compact single-row layout, consistent with table width
- [ ] Style triage table: row borders, hover states, right-aligned amounts, status badges, receipt icons, checkbox styling
- [ ] Style detail modal: clean layout, severity badges, action buttons with proper states (loading, success, error), follow-up textarea
- [ ] Style floating action bar: sits between table and pagination, teal primary button, outline secondary buttons
- [ ] Style pagination: clean prev/next buttons, page indicator
- [ ] Ensure decorative elements do NOT have cursor:pointer or hover effects (see specs/ARCHITECTURE.md "Cosmetic vs Functional")

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Playwright screenshot at 1280px → screenshots/milestone5-styled.png
# Verify: light theme, sidebar 240px with teal active border, color palette matches, table columns correct order, no dead clickable elements
pkill -f "node server.js"
```

---

## Milestone 6: Polish + Edge Cases
**Goal:** Loading states, empty states, error handling, hover/active states, data refresh.

- [ ] Loading states: spinners for summary cards, charts, table, action buttons
- [ ] Empty states: no violations message, no search results, empty tabs
- [ ] Error states: API errors show user-friendly messages
- [ ] Tooltips on charts (formatted USD for spend, counts for violations)
- [ ] Format all amounts as USD ($X,XXX.XX) and dates as locale strings
- [ ] All interactive elements have hover/active states (NOT decorative elements)
- [ ] Verify refresh does NOT create duplicates and preserves review state
- [ ] Refresh button shows loading state, reloads all UI sections
- [ ] Action button feedback: loading spinner, green checkmark on success, red error on failure, auto-dismiss 3s

**Validation gate:**
```bash
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2
# Test refresh preserves reviews
FIRST_TXN=$(curl -sf "http://localhost:3000/api/transactions?status=flagged&limit=1" | python3 -c "import sys,json; print(json.load(sys.stdin)['transactions'][0]['id'])")
curl -sf -X POST http://localhost:3000/api/actions/review -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$FIRST_TXN\",\"review_status\":\"approved\"}"
curl -sf -X POST http://localhost:3000/api/refresh | python3 -m json.tool
curl -sf "http://localhost:3000/api/transactions?status=approved&limit=5" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['total'] > 0, 'Review state lost after refresh!'
"
# Reset and verify no duplicates
curl -sf -X POST http://localhost:3000/api/actions/review -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$FIRST_TXN\",\"review_status\":\"flagged\"}"
python3 -c "
import json
d = json.load(open('data/transactions.json'))
ids = [t['id'] for t in d]
assert len(ids) == len(set(ids)), f'DUPLICATES after refresh'
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
- [ ] Modal adapts to screen width
- [ ] Floating action bar wraps on narrow screens

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
**Goal:** End-to-end verification of every feature in specs/SPEC.md "Done When".

- [ ] Walk through every item in specs/SPEC.md "Done When"
- [ ] Fix anything that doesn't pass
- [ ] Final screenshots at 1280px, 768px, 480px
- [ ] Verify no duplicate transaction IDs
- [ ] Verify no dead buttons
- [ ] Verify full review workflow: flag → under review → approve → back to flagged
- [ ] Verify bulk actions across multiple rows
- [ ] Verify receipt reminder calls real Extend API
- [ ] Update specs/STATUS.md with final state

**Validation gate:**
Run every check from specs/SPEC.md "Done When". Take screenshots. If ALL pass, output `<promise>COMPLETE</promise>`.

---

## Notes

- **One milestone at a time.** Don't start N+1 until N's validation gate passes.
- **If validation fails:** Fix it now. Don't mark complete.
- **Screenshots go in `screenshots/` directory.** Never save to project root.
