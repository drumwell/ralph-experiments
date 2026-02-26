# Status: Living Document

Last updated: 2026-02-18
Current milestone: 5 (Extend UI Design Match)
Iteration count: 30

## Progress

| Milestone | Status |
|-----------|--------|
| 1. Data Layer | ✅ COMPLETE |
| 2. Server + Violations + Review State | ✅ COMPLETE |
| 3. Dashboard Foundation + Triage Table | ✅ COMPLETE |
| 4. Actions + Detail Modal | ✅ COMPLETE |
| 5. Extend UI Design Match | 🔄 IN PROGRESS — tasks 1-7 done, task 8 next |
| 6. Polish + Edge Cases | ⬜ PENDING |
| 7. Responsive | ⬜ PENDING |
| 8. Final QA | ⬜ PENDING |

## What Exists

- `fetch-data.py` — 290 transactions, no duplicates, overwrites on each run
- `server.js` — Express on :3000, all 5 violation rules, review state, bulk actions, reminder endpoint
- `public/index.html` — ~74KB single-file dashboard with sidebar, header, charts, triage table, detail modal, filters, pagination
- `data/transactions.json` — 290 real transactions from Extend API
- `data/reviews.json` — local review state

## Decisions

- Pagination: stop fetching when duplicate IDs appear (Extend API quirk)
- SDK is async: `asyncio.run()` in fetch-data.py
- SDK param: `per_page` not `count`
- Extend reminder API uses AWS Signature auth (not Basic)
- HIGH_VELOCITY triggers at >5 (6+) transactions per card per day
- WEEKEND_SPEND uses `getUTCDay()` not `getDay()`

## Current Task

Milestone 5, task 8: Style triage table (row borders, hover states, right-aligned amounts, status badges, receipt icons, checkbox styling)

## Known Issues

(none)
