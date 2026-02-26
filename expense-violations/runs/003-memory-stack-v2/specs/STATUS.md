# Status: Living Document

Last updated: 2026-02-12
Current milestone: 8 (Final QA) — COMPLETE
Iteration count: 24

## Progress

| Milestone | Status | Iterations | Notes |
|-----------|--------|------------|-------|
| 1. Data Layer | ✅ COMPLETE | 1 | 288 transactions fetched, 0 duplicates |
| 2. Server + Violations | ✅ COMPLETE | 1 | All 5 endpoints verified, 5 violation rules working |
| 3. Dashboard Foundation | ✅ COMPLETE | 1 | All 4 summary cards, 3 charts, top offenders card |
| 4. Table + Interactivity | ✅ COMPLETE | 1 | All 10 tasks done: table, sort, filters, search, pagination, modal, CSV |
| 5. Extend UI Match | ✅ COMPLETE | 9 | All 10 tasks done: sidebar, header, filter bar, color palette, summary cards, charts, table, modal, pagination, decorative element audit |
| 6. Refresh + Polish | ✅ COMPLETE | 5 | All 7 tasks done: refresh button, empty/loading/error states, tooltips, formatting, hover/active states, duplicate verification |
| 7. Responsive | ✅ COMPLETE | 4 | All 5 tasks done: sidebar icon-collapse at 768px, sidebar hide+hamburger at 480px, table horizontal scroll, cards stack vertically, modal adapts to width |
| 8. Final QA | ✅ COMPLETE | 1 | All 21 "Done When" items verified, 0 dead buttons, 0 duplicate IDs |

## Decisions Made

- **Pagination strategy:** The Extend API `count` field is a running total, not per-page count. Pagination stops when `len(transactions) < per_page` (last page has fewer items than requested). ARCHITECTURE.md's description of "count > perPage" doesn't match actual API behavior.
- **Page size:** Using `per_page=100` for efficiency (3 pages instead of 6 with 50).
- **SDK is async:** The `paywithextend` SDK uses async/await. `fetch-data.py` uses `asyncio.run()`.
- **Response structure:** API wraps data in `response.report.transactions`, not `response.transactions`.

## Known Issues

None currently.

## Extend API Field Mapping

Confirmed field names from actual API response:
- `id` → id
- `merchantName` → merchant
- `authBillingAmountCents` → amount_cents
- `authedAt` → date (ISO 8601)
- `virtualCardId` → virtual_card_id
- `vcnDisplayName` → vcn_display_name
- `vcnLast4` → vcn_last4
- `recipientName` → cardholder
- `mcc` → mcc
- `hasAttachments` / `attachmentsCount` → receipt_missing (inverted)
- `status` → status

Additional fields available: `cardholderName`, `mccGroup`, `mccDescription`, `merchantCity`, `merchantState`, `clearingBillingAmountCents`, `clearedAt`, `reviewStatus`, `creditCardDisplayName`, `parentCreditCardDisplayName`, `type` (DEBIT/CREDIT)

## Iteration 2 — Milestone 2 Complete

- Created `package.json` with Express 4.21 dependency
- Wrote `server.js` with: data loading, normalization to internal schema, all 5 violation rules, 6 API endpoints
- Validation results:
  - `/api/summary`: 288 txns, 201 with violations, compliance_rate 30.2%, by_severity sums match
  - `/api/violations`: pagination, rule/severity/search filtering all work, date desc sort verified
  - `/api/trends`: 189 unique days of spend data
  - `/api/violation-trends`: 135 days with violations
  - `/api/top-offenders`: 4 cardholders returned
  - Sort order: confirmed date descending
- All validation gate checks passed

## Architecture Deviations

- **Pagination logic:** ARCHITECTURE.md says "if count > perPage, there are more pages". Actual API behavior: `count` is a running total that always exceeds `perPage` after page 1. Correct termination: `len(transactions_on_page) < per_page`. The ARCHITECTURE.md description is misleading but the code works correctly.

## Iteration 3 — Milestone 3 Complete

- Created `public/index.html` with full dashboard foundation
- Components implemented:
  - Sidebar with nav items, "Card Transactions" active with teal left border
  - Header with "Card Transactions" title
  - 4 summary cards: Total Spend ($11,022.65), Transactions (288), Violations (201), Compliance Rate (30.2%)
  - Doughnut chart: Violations by Rule (MISSING_RECEIPT, DUPLICATE_MERCHANT, WEEKEND_SPEND, HIGH_VELOCITY)
  - Bar chart: Daily Spend Trend with real daily amounts
  - Line chart: Violation Trends over time by rule type (spans full width)
  - Top Offenders card: 4 cardholders with violation counts and top rule
- Chart.js loaded via CDN (v4.4.7)
- All data fetched from API endpoints — no placeholder data
- Screenshot saved to `screenshots/milestone3-dashboard.png`
- Validation gate passed: HTML served, 4 cards visible, 3 charts render with data, top offenders show names

## Iteration 4 — Milestone 4 Complete

- Added complete violations table with all 10 Milestone 4 tasks in a single iteration
- Features implemented:
  - Violations table with 6 columns: Date, Merchant, Card, Card User, Receipts, Amount
  - Default sort by date descending with ▼ indicator
  - Clickable column headers toggle sort direction with visual arrow indicator
  - Severity badges (HIGH/MEDIUM/LOW) with color coding on each row
  - Filter dropdowns: rule type and severity (server-side filtering)
  - Search box: debounced, filters by merchant/cardholder/card/amount
  - Pagination: 25 rows per page, prev/next buttons, "Page X of Y (N results)" indicator
  - Click handler: opens detail modal showing all transaction fields + violations
  - Download CSV: exports current filtered view as CSV
  - Status badges (Pending/Cleared/Declined) with appropriate colors
  - Negative amounts shown in red for declined/reversal transactions
  - Receipt icons (flag/document style SVG) for present/missing
- Validation gate results:
  - WEEKEND_SPEND filter: 85 violations
  - HIGH severity filter: 166 violations
  - Search "amazon": 4 results
  - Table renders with 25 rows, date descending sort
  - Modal opens on row click with full transaction details
  - Pagination shows "Page 1 of 9 (201 results)"
- Screenshot saved to `screenshots/milestone4-table.png`

## Iteration 5 — Milestone 5 Task 1: Sidebar

- Replaced placeholder sidebar with full Extend-style sidebar matching ARCHITECTURE.md exact structure
- Features implemented:
  - 240px wide sidebar with light gray (#f8fafc) background
  - SVG icons next to every nav item (Home, Activity, AI Agent, etc.)
  - Green dot + "Extend Enterprise..." logo at top
  - "99+" red notification badge on Activity
  - Collapsible sections with animated chevrons: My Wallet (Cards, Budgets, Transactions, Reimbursements), Manager Review, Cards (Physical, Virtual, Bill Pay), Accounting (Card Transactions, Statements)
  - Teal (#10b981) left border on active "Card Transactions" item with green tint background
  - Section dividers between nav groups
  - "extend" logo with green dot at bottom (margin-top: auto)
  - All collapsible sections start collapsed, toggle on click with smooth animation
  - Non-collapsible items styled as static (cursor: default, no hover)
  - Collapsible items have cursor: pointer and hover background
- Screenshot saved to `screenshots/milestone5-sidebar.png`

## Iteration 6 — Milestone 5 Task 2: Top Header

- Implemented top header matching ARCHITECTURE.md "Header Layout (EXACT)" spec
- Features implemented:
  - Extend logo (teal SVG icon) on the left
  - "Card Transactions" title (20px, 600 weight)
  - "Create New +" teal button (decorative — cursor: default, no hover, no click handler)
  - Search icon (decorative — cursor: default)
  - User avatar circle "JB" with green background
  - User name "JB" and role "Card Manager" displayed beside avatar
  - All decorative elements have cursor: default and user-select: none per ARCHITECTURE.md rules
- Screenshot saved to `screenshots/milestone5-header-1280.png`

## Iteration 7 — Milestone 5 Task 3: Search/Filter Bar

- Implemented Extend-style search/filter bar matching ARCHITECTURE.md "Search/Filter Bar (EXACT)" spec
- Replaced plain filter dropdowns with two-row filter bar:
  - Row 1: "Transaction Date" label with info icon, search input with magnifying glass, filter toggle icon (functional), "Receipt Tools" label (decorative), download CSV icon (functional)
  - Row 2: Date range label (auto-calculated from trend data: "Feb 9, 2024 - Feb 10, 2026"), rule/severity filter dropdowns, "Export CSV" button
- Functional elements verified:
  - Search input: debounced filtering works (tested with "amazon" → 4 results)
  - Filter toggle: clicking hides/shows filter dropdowns
  - Download CSV: both icon and button trigger CSV export
  - Rule/severity dropdowns: server-side filtering still works
- Decorative elements styled correctly:
  - "Transaction Date" label: cursor: default, user-select: none
  - "Receipt Tools" dropdown: cursor: default, user-select: none
  - Date range: cursor: default, user-select: none
- Screenshot saved to `screenshots/milestone5-filterbar.png`

## Iteration 8 — Milestone 5 Task 4: Apply Extend Color Palette

- Audited all CSS colors against ARCHITECTURE.md color palette — most were already correct from prior iterations
- Changes made:
  - Content area background: changed from `#ffffff` to `#f8fafc` — makes white cards/tables pop with subtle contrast
  - Chart colors: created shared `RULE_COLORS` constant for consistent rule-to-color mapping across doughnut chart and violation trend line chart
    - MISSING_RECEIPT: `#ef4444` (red)
    - DUPLICATE_MERCHANT: `#f97316` (orange)
    - ROUND_AMOUNT: `#6366f1` (indigo)
    - WEEKEND_SPEND: `#eab308` (yellow)
    - HIGH_VELOCITY: `#10b981` (green)
  - Chart axis labels: set to `#64748b` (text secondary) with proper font family
  - Chart grid lines: set to `#e2e8f0` (border color)
  - Chart legend text: set to `#64748b` with system-ui font
- Verified all palette tokens match ARCHITECTURE.md:
  - Background: `#ffffff` (cards) / `#f8fafc` (content area, sidebar)
  - Primary accent: `#10b981` (buttons, active states, sort arrows)
  - Text primary: `#1e293b`, Text secondary: `#64748b`
  - Border: `#e2e8f0`
  - Status colors: Active `#10b981`, Pending `#6b7280`, Declined `#ef4444`, Cancelled `#f97316`
  - Severity badges: HIGH `#ef4444`, MEDIUM `#f97316`, LOW `#eab308`
- No console errors
- Screenshot saved to `screenshots/milestone5-palette-applied.png`

## Iteration 9 — Milestone 5 Task 5: Style Summary Cards

- Refined summary card CSS for polished, production-quality appearance
- Changes made:
  - Card padding: increased to `20px 24px` for more generous spacing
  - Card shadow: dual-layer shadow (`0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)`) for subtler depth
  - Card hover: added elevated shadow on hover (`0 4px 12px rgba(0,0,0,0.08)`) with smooth transition
  - Card labels: uppercase text-transform, 500 weight, subtle letter-spacing (0.01em) for clean dashboard style
  - Card values: increased to 28px font-size for more visual impact, added `line-height: 1.2`
  - Compliance Rate card: green (#10b981) value already in place
- All 4 cards visible at 1280px width: Total Spend, Transactions, Violations, Compliance Rate
- No console errors
- Screenshot saved to `screenshots/milestone5-cards-styled.png`

## Iteration 10 — Milestone 5 Task 6: Style Charts

- Refined chart card CSS and Chart.js configurations for polished, production-quality appearance
- Chart card CSS changes:
  - Dual-layer shadow matching summary cards (`0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)`)
  - Hover shadow effect (`0 4px 12px rgba(0,0,0,0.08)`) with smooth transition
  - Same hover treatment applied to top offenders card for consistency
- Doughnut chart improvements:
  - `cutout: 60%` for cleaner donut proportions
  - White borders between segments (`borderWidth: 2, borderColor: #ffffff`)
  - Hover offset of 4px for segment pop-out effect
  - Legend with `usePointStyle: true, pointStyle: 'circle'` for cleaner look
  - Tooltip shows count and percentage (e.g., "MISSING RECEIPT: 159 (52.3%)")
- Bar chart (Daily Spend Trend) improvements:
  - `borderRadius: 3` with `borderSkipped: false` for rounded bar tops
  - Hover color change to darker green (`#059669`)
  - Y-axis: `border.display: false` for cleaner look, font size 11px
  - Tooltip shows formatted date ("Jan 5, 2026") and USD amount ("$45.67")
- Line chart (Violation Trends) improvements:
  - `interaction.mode: 'index'` with `intersect: false` for crosshair-style tooltip (shows all rules at once)
  - Y-axis: `border.display: false` for cleaner look, font size 11px
  - Legend with `usePointStyle: true, pointStyle: 'line'`, padding 16px
  - Tooltip shows formatted date and per-rule counts
- All 3 charts have consistent tooltip styling: `backgroundColor: #1e293b`, `cornerRadius: 6`, system-ui font
- Verified via JavaScript evaluation: all 3 Chart instances have proper tooltip config with callbacks
- No console errors (only favicon 404)
- Screenshot saved to `screenshots/milestone5-charts-styled.png`

## Iteration 11 — Milestone 5 Task 7: Style Violations Table

- Refined violations table CSS and HTML for polished, production-quality appearance
- Table header changes:
  - Uppercase column headers with `letter-spacing: 0.03em` and `text-transform: uppercase`
  - 2px bottom border on header row for visual weight
  - Font size 12px for compact, clean header labels
- Table row changes:
  - Subtler row borders (`#f1f5f9` instead of `#e2e8f0`) for cleaner look
  - Smooth hover transition (`transition: background-color 0.15s ease`)
  - Vertical align middle for better row alignment
  - Increased padding (12px 16px) for more generous spacing
- Date cell: Separated date text and severity badges into distinct divs with `severity-badges` container using flexbox with gap
- Severity badges: Deduplicated (show each level only once per row), smaller font (10px), bolder weight (600)
- Merchant cell: Changed "MCC: 5734" format to "MCC 5734" (cleaner, no colon)
- Card last4: Lighter color (`#94a3b8`) for secondary info
- Amount cell: Bold weight (600), explicit `#1e293b` color, `white-space: nowrap`
- Status badges: Title-cased labels (Pending, Cleared, Declined) instead of all-caps, with `margin-top: 4px` spacing
- Receipt icons: Added `inline-flex` container with `border-radius: 6px`, missing receipts get `background: #fef2f2` (red tint) for visual distinction
- Pagination: Added `background: #ffffff`, increased button padding, smoother disabled state (`#cbd5e1` text, `#f1f5f9` border), hover border darkening
- All filtering, search, sort, modal, and CSV export verified working
- Screenshots saved to `screenshots/milestone5-table-styled.png` and `screenshots/milestone5-table-pagination.png`

## Iteration 12 — Milestone 5 Task 8: Style Detail Modal

- Restyled the detail modal for polished, production-quality appearance
- Modal structure changes:
  - Removed padding from `.modal` container — now handled by sections (header, body, violations footer)
  - Added `modal-body` div wrapping the transaction fields
  - Added separate `modalViolations` div for the violations footer section
- Header changes:
  - Bordered close button (32x32px, rounded 8px, 1px `#e2e8f0` border) instead of bare text
  - Close button hover: darker border (`#cbd5e1`), gray bg (`#f1f5f9`), darker text color
  - Bottom border separating header from body
- Field layout changes:
  - Uppercase labels with `letter-spacing: 0.02em`, 12px font size, `#64748b` color
  - Values with `font-weight: 500` for better readability
  - Transaction ID in monospace, lighter color (`#94a3b8`) for de-emphasis
  - Amount field: larger (15px), bold (600), with status badge inline
  - Declined/reversal amounts shown in red (`#ef4444`)
  - Receipt field: "Missing" in red, "Present" in green
- Violations section:
  - Gray background footer (`#f8fafc`) with top border, bottom rounded corners
  - "VIOLATIONS (N)" header: uppercase, letter-spacing, 12px, secondary color
  - Each violation in a white card with `#e2e8f0` border, 8px rounded corners
  - Rule name in bold, description below in gray (12px)
  - Severity badge left-aligned, flex-start for multi-line content
- Overlay: darker slate-based rgba, 2px backdrop blur
- Close button (X), clicking overlay, and Escape key all close modal
- Verified with both Pending and Declined transactions
- Screenshots saved to `screenshots/milestone5-modal-styled.png` and `screenshots/milestone5-modal-declined.png`

## Iteration 13 — Milestone 5 Task 9: Style Pagination

- Refined pagination CSS for polished, production-quality appearance
- Changes made:
  - Added `border-radius: 0 0 8px 8px` to pagination bar so bottom corners match the table wrap container
  - Added `pagination-info` class with `font-weight: 500` for bolder page indicator text
  - Button hover state: teal-tinted — `background: #f0fdf4`, `border-color: #10b981`, `color: #10b981` (matches Extend accent)
  - Button active state: darker teal — `background: #ecfdf5`, `border-color: #059669`, `color: #059669`
  - Disabled button background changed from `#f8fafc` to `#fafafa` for subtler distinction
- Verified on page 1 (Previous disabled, Next enabled) and page 2 (both enabled)
- Hover state shows teal accent color matching the rest of the UI
- Screenshots saved to `screenshots/milestone5-pagination-styled.png` and `screenshots/milestone5-pagination-page2.png`

## Iteration 14 — Milestone 5 Task 10: Decorative Element Audit (Milestone 5 COMPLETE)

- Audited all UI elements against ARCHITECTURE.md "Cosmetic vs Functional" rules
- **Issue found and fixed:** "Receipts" column header had `cursor: pointer` from the blanket `th` CSS rule, but had no `data-sort` attribute and no click handler — this made it look clickable but do nothing
- **Fix:** Changed `.violations-table thead th` from `cursor: pointer` to `cursor: default`, added new `.violations-table thead th[data-sort]` rule with `cursor: pointer` — only sortable columns get pointer cursor
- **Comprehensive programmatic verification performed:**
  - All decorative elements confirmed `cursor: default`: Create New button, header search icon, user avatar/name, Receipt Tools, date range, Transaction Date label
  - All non-collapsible sidebar items confirmed `cursor: default`: Home, Activity, AI Agent, Budgets, People, Insights, Settings, Help & Support
  - Zero "suspicious pointer" elements found — every `cursor: pointer` element belongs to a functional category (buttons, selects, sortable th, collapsible sidebar items, clickable filter icons, table rows)
  - All collapsible sidebar items correctly have `cursor: pointer` + click handlers
- Screenshot saved to `screenshots/milestone5-decorative-audit.png`
- **Milestone 5 is now COMPLETE** — all 10 tasks done

## Iteration 15 — Milestone 6 Task 1: Wire Refresh Data Button

- Added "Refresh Data" button to the filter bar's second row, next to "Export CSV"
- Button styling: white background, `#e2e8f0` border, hover turns teal, consistent with Extend palette
- Loading state:
  - Button disabled during refresh
  - `.loading` class added to button — triggers CSS `@keyframes spin` animation on the refresh icon
  - Label changes to "Refreshing..." during fetch
  - On error: shows "Refresh Failed" for 3 seconds then reverts to "Refresh Data"
- On success:
  - All Chart.js instances destroyed before re-rendering (prevents canvas reuse errors)
  - All dashboard sections reloaded in parallel: summary cards, 3 charts, top offenders, date range
  - Violations table resets to page 1 and reloads
- Verified:
  - `POST /api/refresh` returns `{ status: "ok", transaction_count: 288 }`
  - No duplicate transaction IDs after refresh (288 records, 288 unique)
  - Dashboard fully reloads with fresh data after clicking the button
  - No console errors (only favicon 404)
- Screenshot saved to `screenshots/milestone6-refresh-button.png`

## Iteration 16 — Milestone 6 Task 2: Empty States, Loading Spinners, Error States

- Added CSS spinner animation (teal border-top, `@keyframes spin`) for loading states
- Replaced all "Loading..." text placeholders with animated spinner + text:
  - Summary cards: spinner while loading
  - Top offenders: spinner while loading
  - Violations table: spinner while loading
- Added `fetchJSON` retry logic: retries once after 1s delay before failing (per ARCHITECTURE.md)
- Empty states with icons and contextual messages:
  - Violations table (no filter match): checkmark icon, "No matching violations", "Try adjusting your filters or search terms."
  - Violations table (no data): checkmark icon, "No violations found", "All transactions are compliant."
  - Top offenders (empty): person+ icon, "No offenders found", "All cardholders are compliant."
  - Date range (no data): "No transaction data available"
- Error states with warning icon and user-friendly messages:
  - Summary cards: "Unable to load summary" + "Please try refreshing the page."
  - Top offenders: "Unable to load offenders" + "Please try refreshing the page."
  - Violations table: "Unable to load violations" + "Please try refreshing the page."
  - All 3 charts: "Unable to load chart" + "Please try refreshing the page."
  - No raw JSON or technical errors shown to users
- Verified:
  - Dashboard loads normally with all data (288 txns, 201 violations)
  - Search for "zzzznonexistent" shows proper empty state with icon
  - Clearing search restores full table
  - No console errors (only favicon 404)
- Screenshots saved to `screenshots/milestone6-empty-states.png` and `screenshots/milestone6-empty-state-table.png`

## Iteration 17 — Milestone 6 Tasks 3-5: Error States, Tooltips, Formatting

- Confirmed error states were already complete from iteration 16 (all load functions have catch blocks with user-friendly messages)
- Confirmed chart tooltips were already complete from prior iterations:
  - Doughnut: count + percentage per rule
  - Bar chart: formatted date + USD amount
  - Line chart: formatted date + per-rule counts
- Updated `formatDate()` from manual `M/D/YYYY` format to locale string: `toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })`
  - Now shows "Feb 11, 2026" instead of "2/11/2026"
  - Applied in both table rows and detail modal
- Verified all amounts use `formatUSD()` consistently ($X,XXX.XX format)
- Screenshot saved to `screenshots/milestone6-formatting.png`

## Iteration 18 — Milestone 6 Task 6: Interactive Hover/Active States

- Audited all interactive and decorative elements for proper hover/active states
- Added missing CSS hover/active states to interactive elements:
  - Sortable column headers (`th[data-sort]`): hover changes color to `#1e293b`, active changes to teal `#10b981`, with `transition: color 0.15s ease`
  - Clickable filter bar icons (`.filter-bar-icon.clickable`): added `:active` state with `background: #e2e8f0`
  - Filter dropdown selects: added `:focus` state with teal border (`#10b981`) and subtle green box-shadow
  - Export CSV button (`.btn-csv`): added `:active` state with darker green (`#047857`)
  - Refresh Data button (`.btn-refresh`): added `:active:not(:disabled)` state with darker teal border/color and light green bg
  - Modal close button (`.modal-close`): added `:active` state with `background: #e2e8f0` and darker border
  - Search input: added explicit `:focus` with `outline: none` (uses browser focus ring naturally)
- Programmatic verification confirmed zero issues:
  - All 8 decorative element types have `cursor: default`
  - All 9 interactive element types have `cursor: pointer`
  - No stray pointer cursors on non-functional elements
- Screenshot saved to `screenshots/milestone6-hover-states.png`

## Iteration 19 — Milestone 6 Task 7: Verify Refresh No Duplicates (Milestone 6 COMPLETE)

- Verified refresh endpoint does NOT create duplicate records
- Ran `POST /api/refresh` twice in succession
- After each refresh: 288 records, 288 unique IDs — zero duplicates
- Summary API returns correct data after multiple refreshes (288 txns, 201 violations, 30.2% compliance)
- Full Milestone 6 validation gate passed:
  - Refresh endpoint returns `{ "status": "ok", "transaction_count": 288 }`
  - No duplicate IDs in `data/transactions.json` after refresh
  - Visual verification screenshot saved
- Screenshot saved to `screenshots/milestone6-polish.png`
- **Milestone 6 is now COMPLETE** — all 7 tasks done

## Iteration 20 — Milestone 7 Task 1: Sidebar Collapses to Icons at 768px

- Added `@media (max-width: 768px)` responsive CSS block
- Sidebar changes at 768px:
  - Width shrinks from 240px to 56px
  - All nav labels, badges, and chevrons hidden (`display: none`)
  - Icons remain visible and centered
  - Logo area shows just the green dot (text hidden via `font-size: 0`)
  - Subnav items hidden (`display: none !important`)
  - Active item teal left border still visible
  - Bottom "extend" text hidden, only green dot remains
- Additional tablet adaptations included:
  - Summary cards: 2-column grid (from 4)
  - Charts: single-column grid (from 2)
  - Violation trend chart: `grid-column: span 1` override
  - Header: "Create New +" button and user info text hidden
  - Filter bar: "Transaction Date" label and "Receipt Tools" hidden, search input takes full width
  - Filter dropdowns wrap on smaller widths
- Verified:
  - 768px: sidebar shows icons only, cards in 2 columns, charts single-column, no overflow
  - 1280px: full desktop layout unchanged, no regressions
- Screenshots saved to `screenshots/milestone7-tablet-768px.png` and `screenshots/milestone7-desktop-1280px.png`

## Iteration 21 — Milestone 7 Task 2: Sidebar Hides at 480px, Hamburger Menu

- Added `@media (max-width: 480px)` responsive CSS block
- Sidebar behavior at 480px:
  - Sidebar hidden off-screen with `transform: translateX(-100%)` and `position: fixed`
  - Full 240px width restored when opened (overrides the 768px icon-only collapse)
  - Slides in with smooth 0.25s CSS transition
  - Dark overlay backdrop (`rgba(15, 23, 42, 0.4)`) appears behind sidebar
- Hamburger menu button:
  - Three-line SVG icon in a bordered button, positioned in header-left before the logo
  - Hidden by default (`display: none`), shown at 480px (`display: flex`)
  - Toggles `mobile-open` class on sidebar and `visible` class on overlay
- Close mechanisms:
  - Clicking the overlay backdrop closes sidebar
  - Pressing Escape key closes sidebar (and modal)
  - Clicking hamburger again toggles sidebar closed
- Additional mobile adaptations at 480px:
  - Summary cards: single column (`grid-template-columns: 1fr`)
  - Header: compact padding (12px 16px), smaller title (16px), search icon hidden
  - Content: reduced padding (16px)
  - Modal: 95vw width for full-width display
- Verified at all 3 breakpoints:
  - 1280px: full desktop layout, no hamburger, no regressions
  - 768px: icon-only sidebar, no hamburger, 2-column cards
  - 480px: sidebar hidden, hamburger visible, single-column cards, sidebar opens/closes correctly
- Screenshots saved to `screenshots/milestone7-mobile-480px.png` and `screenshots/milestone7-mobile-sidebar-open.png`

## Iteration 22 — Milestone 7 Task 3: Table Scrolls Horizontally on Small Screens

- Added `min-width: 700px` to `.violations-table` so it maintains readable column widths on narrow viewports
- Added `max-width: 100%` to `.violations-table-wrap` to constrain wrap to parent width
- Added `min-width: 0` to `.main`, `.content`, `.charts-grid` to prevent flex children from overflowing
- Added `overflow: hidden` to `.chart-card` to prevent Chart.js canvases from expanding beyond container
- Fixed pre-existing body overflow issue at 768px caused by chart canvases pushing the grid wider
- Verified at all 3 breakpoints:
  - 1280px: no horizontal scroll on table (990px table fits 990px wrap), no body overflow
  - 768px: table scrolls horizontally (700px table in 662px wrap), body does NOT overflow (fixed!)
  - 480px: table scrolls horizontally (700px table in 446px wrap), body does NOT overflow
- Also confirmed: cards already stack vertically at 480px (task 4) and modal already adapts to 95vw (task 5)
- Screenshot saved to `screenshots/milestone7-table-scroll-480px.png`

## Iteration 23 — Milestone 7 Tasks 4-5: Cards Stack + Modal Adapts (Milestone 7 COMPLETE)

- Verified tasks 4 and 5 were already implemented in prior iterations:
  - Task 4 (cards stack vertically): `grid-template-columns: 1fr` at 480px confirmed working — all 4 summary cards in single column
  - Task 5 (modal adapts): modal width set to `95vw` at 480px confirmed working — fits nicely within viewport
- Ran full Milestone 7 validation gate with screenshots at all 3 breakpoints:
  - 1280px: full desktop layout, sidebar expanded, 4-column cards, side-by-side charts, no overflow
  - 768px: icon-only sidebar, 2-column cards, single-column charts, table scrolls horizontally, no overflow
  - 480px: sidebar hidden with hamburger, single-column cards, table scrolls horizontally, modal at 95vw, no overflow
- All screenshots confirm NO overflow, NO broken layout, NO cut-off text
- Screenshots saved to `screenshots/milestone7-desktop-1280px.png`, `screenshots/milestone7-tablet-768px.png`, `screenshots/milestone7-mobile-480px.png`, `screenshots/milestone7-modal-mobile-480px.png`
- **Milestone 7 is now COMPLETE** — all 5 tasks done

## Iteration 24 — Milestone 8: Final QA (COMPLETE)

- Walked through every item in specs/SPEC.md "Done When" checklist
- **API Endpoints (all verified):**
  - `/api/summary`: 288 txns, 201 violations, 30.2% compliance, severity breakdown correct
  - `/api/violations`: pagination working (201 total, 9 pages), date descending sort confirmed
  - `/api/violations?rule=WEEKEND_SPEND`: 85 results
  - `/api/violations?severity=HIGH`: 166 results
  - `/api/violations?search=amazon`: 4 results
  - `/api/trends`: 189 days of spend data
  - `/api/violation-trends`: 135 days of violation data
  - `/api/top-offenders`: 4 cardholders (Jonathan Bailey 272, Stephanie Coste 2, Jia Lin 1, Michelle Kuo 1)
  - `POST /api/refresh`: returns `{ status: "ok", transaction_count: 288 }`
- **Data Integrity:** 288 records, 288 unique IDs — zero duplicates
- **Visual Verification (1280px):** sidebar, header, 4 summary cards, 3 charts, top offenders, filter bar, violations table with severity badges, pagination — all rendering correctly
- **Interactive Features:**
  - Modal: opens on row click, shows all fields + violations with severity badges, closes with X/overlay/Escape
  - Filters: rule type and severity dropdowns filter correctly server-side
  - Search: debounced, filters by merchant/cardholder/card/amount
  - Sort: date descending by default, column headers toggle direction
  - Pagination: 25 rows/page, Previous disabled on page 1, Next works
  - CSV export: button functional
  - Refresh: button triggers re-fetch + full UI reload
- **Dead Button Audit:** 0 dead buttons found — every cursor:pointer element has a functional handler
- **Responsive (768px):** sidebar collapsed to icons, 2-column cards, charts single-column, table scrolls horizontally, no overflow
- **Responsive (480px):** sidebar hidden with hamburger toggle, single-column cards, table scrolls horizontally, no overflow
- Screenshots saved to `screenshots/milestone8-qa-desktop-1280px.png`, `screenshots/milestone8-qa-tablet-768px.png`, `screenshots/milestone8-qa-mobile-480px.png`, `screenshots/milestone8-qa-modal.png`
- **ALL 21 "Done When" items VERIFIED. Milestone 8 COMPLETE.**
