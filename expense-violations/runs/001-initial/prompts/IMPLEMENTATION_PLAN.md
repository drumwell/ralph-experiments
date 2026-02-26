# Implementation Plan

## Tasks

### Phase 1: Data Layer
- [ ] Fetch all transactions from Extend API (paginated), write to `data/transactions.json`
- [ ] Deduplicate by transaction ID — stop when you see repeats
- [ ] Verify: JSON file has ~100-300 unique transactions, reasonable total spend

### Phase 2: Server
- [ ] Create `package.json` with Express dependency
- [ ] Create `server.js` — load transactions, normalize data, implement violation detection
- [ ] Implement API endpoints: `/api/summary`, `/api/violations`, `/api/trends`
- [ ] Verify: all endpoints return valid JSON with real data

### Phase 3: Dashboard
- [ ] Create `public/index.html` — dashboard UI with Chart.js
- [ ] Summary cards, violation doughnut chart, daily spend bar chart, violations table
- [ ] Verify: dashboard renders in browser with real data

### Phase 4: Match Extend UI
- [ ] Restyle to match Extend's light theme — see AGENTS.md for exact specs
- [ ] Add sidebar navigation matching AGENTS.md structure
- [ ] Add top header with "Card Transactions" title, "Create New +" button, user avatar
- [ ] Add search/filter bar with date picker, search input, filter/download icons
- [ ] Style table to match Extend: proper columns (Date, Merchant, Card, Card User, Receipt, Amount), status badges, receipt flag icons, amount formatting
- [ ] Verify with Playwright: screenshot at 1280px, compare against AGENTS.md specs

### Phase 5: Polish to Production Quality
- [ ] Add responsive behavior: sidebar collapses at 768px, hides at 480px, table scrolls horizontally
- [ ] Verify with Playwright: screenshot at 1280px, 768px, and 480px — confirm no overflow or broken layout
- [ ] Final visual verification: screenshot at 1280px, compare every element against AGENTS.md. If fewer than 3 minor issues remain, mark complete.

## Notes

Update this file as you complete tasks. Mark items with `[x]` when done.

**IMPORTANT:** Do ONE task per iteration, then commit and exit. Don't try to do multiple tasks at once.
