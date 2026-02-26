# Implementation Plan

## Tasks

### Phase 1: Data Layer
- [x] Create `fetch-data.py` — fetch all transactions from Extend API (paginated), write to `data/transactions.json`
- [x] Verify data fetch works — run script, confirm JSON file has transactions

### Phase 2: Server
- [x] Create `package.json` with Express dependency
- [x] Create `server.js` — load transactions, normalize data, implement violation detection
- [x] Implement `GET /api/summary` endpoint
- [x] Implement `GET /api/violations` endpoint
- [x] Implement `GET /api/trends` endpoint
- [x] Verify all API endpoints return valid JSON

### Phase 3: Dashboard
- [x] Create `public/index.html` — dashboard UI with Chart.js
- [x] Summary cards (total spend, transactions, violations, compliance %)
- [x] Violations by type doughnut chart
- [x] Daily spend bar chart
- [x] Violations table with sortable columns
- [x] Verify dashboard renders correctly in browser

### Phase 4: Data Quality Fix (CRITICAL)
- [x] Fix duplicate transactions — dedupe by transaction ID in fetch-data.py OR server.js
- [x] Re-fetch clean data (delete data/transactions.json first, then re-run fetch)
- [x] Verify transaction count matches reality (~100-300, not 8,000+)
- [x] Verify total spend is reasonable (~$10K, not $300K)

### Phase 5: Polish
- [x] End-to-end verification — all endpoints work, charts render, table has data
- [x] Clean up any console errors or warnings

### Phase 6: Match Extend UI (ONE TASK PER ITERATION)

**Reference:** Extend uses a light theme with teal/green accents. See AGENTS.md for exact colors.

#### 6.1 Theme Overhaul
- [x] Switch from dark theme to light theme (white background, dark text)
- [x] Verify: page should have white/light gray background, readable dark text

#### 6.2 Sidebar Navigation
- [x] Add left sidebar with navigation items: Home, Activity, Cards, Budgets, Card Transactions
- [x] Style sidebar to match Extend (icons, hover states, active indicator)
- [x] Verify: sidebar renders, items are clickable (can be non-functional links for now)

#### 6.3 Header Bar
- [x] Add top header with logo area, search bar placeholder, and user avatar placeholder
- [x] Verify: header spans full width, looks professional

#### 6.4 Search & Filter Bar
- [x] Add search input: "Enter an amount, merchant name, or card name"
- [x] Add date range display (e.g., "Jan 5, 2026 - Feb 4, 2026")
- [x] Add filter icon button and download icon button
- [x] Verify: search bar renders above the table

#### 6.5 Table Styling
- [x] Restyle violations table to match Extend: light background, subtle row borders
- [x] Add proper column headers: Date, Merchant, Card, Card User, Amount
- [x] Right-align amount column
- [x] Verify: table looks like Extend's Card Transactions table

#### 6.6 Status Badges
- [x] Add transaction status badges: Pending (gray), Declined (red), Cleared (green), Reversal (red)
- [x] Style badges as pills with appropriate colors
- [x] Verify: status shows next to amount in table

#### 6.7 Receipt Icons
- [x] Add receipt icon column showing receipt status (checkmark, missing, etc.)
- [x] Verify: receipt icons appear in table

#### 6.8 Amount Formatting
- [x] Format amounts like Extend: positive in black, negative/reversal in red with minus sign
- [x] Show "Pending", "Declined", "Reversal" status text below amount
- [x] Verify: amounts display correctly with status

#### 6.9 Polish & Verify
- [x] Test full page layout at different screen widths
- [x] Fix any visual bugs or alignment issues
- [x] Verify: dashboard looks professional and similar to Extend

#### 6.10 Final Review
- [x] Screenshot comparison with real Extend UI
- [x] Document any remaining differences
- [x] Verify: all Phase 6 tasks complete and working

### Phase 7: Polish to 95% (ONE TASK PER ITERATION)

**Goal:** Match Extend's UI exactly. See AGENTS.md for detailed specs.

#### 7.1 Card Column Fix
- [x] Change Card column from `virtualCardId` to `vcnDisplayName`
- [x] Show `vcnLast4` below card name in small gray text
- [x] Verify: Card column shows "AI Tool VCN (Nov...)" with "5734" below

#### 7.2 Sidebar Structure
- [x] Add Extend logo at top of sidebar (teal icon + "Extend Enterprise...")
- [x] Add collapsible "My Wallet" section with: Cards, Budgets, Transactions, Reimbursements
- [x] Add "Manager Review" section
- [x] Add Settings, Help & Support at bottom
- [x] Verify: Sidebar matches exact structure in AGENTS.md

#### 7.3 Header Improvements
- [x] Add "Create New +" button (teal, rounded) on right side
- [x] Add page breadcrumb/title "Card Transactions"
- [x] Add user name "Card Manager" below avatar
- [x] Verify: Header matches Extend's layout

#### 7.4 Merchant Column Enhancement
- [x] Add merchant category icon (📦 or similar) before merchant name
- [x] Show MCC category label below merchant (e.g., "RETAIL")
- [x] Verify: Merchant column has icon + category label

#### 7.5 Receipt Icon Style
- [x] Change receipt icon from checkmark/warning to flag/document style
- [x] Match Extend's exact receipt indicator
- [x] Verify: Receipt column uses flag icon

#### 7.6 Date Picker Styling
- [x] Style date range as clickable picker with calendar icon
- [x] Add "Transaction Date" label with info icon
- [x] Verify: Date picker matches Extend's style

#### 7.7 Final Polish
- [x] Add "Receipt Tools" dropdown button
- [x] Ensure all spacing/padding matches Extend
- [x] Test responsive behavior: Use Playwright to screenshot the dashboard at 1280px wide, then at 768px wide, then at 480px wide. Confirm the sidebar collapses, the table scrolls horizontally, and no content overflows. If anything breaks, fix the CSS.
- [x] Final visual verification: Use Playwright to screenshot `http://localhost:3000` at 1280px wide. Compare every element against the specs in AGENTS.md (colors, layout, sidebar structure, header, table columns, badges, icons). List any mismatches you find. If there are fewer than 3 minor issues, mark this task done and output `<promise>COMPLETE</promise>`.

## Notes

Update this file as you complete tasks. Mark items with `[x]` when done.

**IMPORTANT:** Do ONE task per iteration, then commit and exit. Don't try to do multiple tasks at once.
