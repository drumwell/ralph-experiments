# Spec: Extend Spend Intelligence Platform

## Goal

Build a production-quality, multi-page spend intelligence platform that connects to the Extend API, analyzes real transaction data across multiple dimensions, and surfaces actionable insights through rich visualizations and interactive drill-downs. The platform enables finance teams to explore trends over configurable time periods, compare spending across periods, drill into categories and cardholder profiles, triage outliers, and take action — all through a polished, design-forward interface.

## Non-Goals

- No user-facing authentication — API access uses EXTEND_API_KEY and EXTEND_API_SECRET environment variables
- No database — file-based JSON storage only (triage state stored in `data/triage.json`)
- No build toolchain — no webpack, no TypeScript, no React framework
- No mock data — all data comes from the live Extend API
- No deployment — local development server only
- Do not invent new outlier rules beyond what is specified

## Hard Constraints

- **Single HTML file with client-side routing:** one `public/index.html`, vanilla JS, hash-based routing (`#/overview`, `#/trends`, etc.)
- **No build step:** the app must work by running `node server.js` and visiting `localhost:3000`
- **Express on port 3000:** one `server.js` file handles API + static serving
- **Python data fetch:** one `fetch-data.py` script using `paywithextend` SDK
- **Chart.js for charts:** loaded via CDN. No other charting libraries.
- **Real field names:** use exact Extend API field names discovered at runtime, never guess
- **Deterministic outliers:** same input data must always produce same outlier results
- **Actions use Extend API:** receipt reminders call the real Extend API endpoint

## Deliverables

When finished, these files must exist and work:

```
fetch-data.py           # Fetches paginated transactions from Extend API
server.js               # Express server: API endpoints + analytics engine + outlier detection + actions + static files
public/index.html       # Complete multi-page UI (single file, hash routing)
data/transactions.json  # Cached transaction data (200-300 unique records)
data/triage.json        # Local triage state (triage_status per transaction ID)
package.json            # Node dependencies (express only)
```

## Pages

### 1. Overview (`#/overview` — default)
The executive summary. At a glance, what's happening with spending?

- 4 summary cards with sparkline trends: Total Spend, Transaction Count, Outliers Detected, Average Transaction
- Each summary card shows the metric value AND a comparison delta vs the previous period (e.g., "+12.3% vs prior period")
- Spend over time area chart with 7-day moving average (respects date range)
- Category breakdown horizontal bar chart (top 10 by spend)
- Quick-view outlier table (latest 5 flagged, with "View all →" link to Outliers page)
- Recent activity feed (last 10 transactions as a compact list)

### 2. Trends (`#/trends`)
Deep-dive into spending patterns over time.

- **Date range picker** at the top: preset buttons (7d, 30d, 90d, All) plus custom date inputs. This is the global date range control — changing it here updates ALL pages.
- **Period comparison toggle**: "Compare to previous period" checkbox. When enabled, charts show current period vs previous period side by side.
- Spend over time chart (larger, more detailed than overview) with moving average
- Daily transaction count chart
- Average transaction size over time chart
- Cumulative spend chart (running total over the period)
- Spend by day-of-week heatmap (using data within the selected date range)

### 3. Categories (`#/categories`)
Understand where money is going by category.

- Category breakdown bar chart (all categories, not just top 10)
- Category table: Category name, Total Spend, Transaction Count, % of Total, Avg Transaction, Outlier Count
- Click a category row to drill down → shows all transactions in that category (inline expansion or filtered view)
- Category trend sparklines in the table (mini line chart of that category's spend over time)

### 4. Cardholders (`#/cardholders`)
Per-person spending profiles.

- Cardholder table: Name, Total Spend, Transaction Count, Outlier Count, Top Category, Avg Transaction
- Click a cardholder row to expand their profile inline:
  - Spending timeline (mini chart of their transactions over time)
  - Their top categories (mini bar chart)
  - Their outlier history (list of flagged transactions with context)
  - Quick actions: send receipt reminders for their missing-receipt transactions
- Sort by any column, search by name

### 5. Outliers (`#/outliers`)
The triage workflow surface — this is the primary action page.

- Status bucket tabs: Flagged | Acknowledged | Investigating | All Transactions
- Inline filter row: Type dropdown, Severity dropdown, Search input, Export CSV, Refresh Data
- Transaction table with checkbox column + 6 data columns (Date, Merchant, Category, Card, Card User, Amount)
- Column sorting, severity badges, pagination (25 per page)
- Row click opens detail modal with:
  - Full transaction details
  - Outlier Analysis context cards (server-computed context strings)
  - Triage action buttons (Acknowledge, Investigate)
  - Send Receipt Reminder button (conditional on receipt_missing)
- Bulk actions: floating action bar when rows selected (Send Reminders, Acknowledge, Investigate)

## Cross-Cutting Features

### Global Date Range
- Date range picker lives on the Trends page but the selected range persists across all pages
- Default range: "All" (all available data)
- When a range is active, all API calls include `from` and `to` query params
- Summary cards, charts, and tables all respect the active date range
- A subtle indicator in the header shows the active date range on every page

### Period Comparison
- When enabled on the Trends page, the Overview summary cards show delta percentages
- Charts on Trends page show dual series (current vs previous)
- Comparison is calculated server-side via `/api/comparison` endpoint

### Command Palette
- `Cmd+K` (Mac) / `Ctrl+K` (Windows) opens a command palette overlay
- Search across: page navigation, transactions (by merchant/cardholder), actions (refresh data, export CSV)
- Results update as you type (debounced 200ms)
- Arrow keys to navigate results, Enter to select, Escape to close
- Subtle, clean UI — inspired by Linear's command palette

### Keyboard Shortcuts
- `g o` → go to Overview
- `g t` → go to Trends
- `g c` → go to Categories
- `g h` → go to Cardholders
- `g l` → go to Outliers
- `j` / `k` → navigate table rows (down/up)
- `Enter` → open detail modal for selected row
- `Escape` → close modal or command palette
- `?` → show keyboard shortcut help overlay
- Shortcuts shown as subtle hints in the UI (e.g., in sidebar nav items, in button tooltips)

### Toast Notifications
- Non-blocking feedback for all actions (triage changes, reminders, CSV export, data refresh)
- Auto-dismiss after 3 seconds, with manual close button
- Stack from bottom-right

## Features Summary

### Data & Detection
1. Fetch paginated transactions from Extend API using `paywithextend` SDK
2. Six outlier detection rules with severity levels (see ARCHITECTURE.md)
3. Date-range-aware analytics (all endpoints accept `from`/`to` params)
4. Period-over-period comparison computation

### Visualizations (across all pages)
5. Summary cards with sparklines and period deltas
6. Spend over time (area chart + moving average)
7. Category breakdown (bar chart + table with sparklines)
8. Top spenders visualization
9. Spend distribution histogram
10. Day-of-week heatmap
11. Daily transaction count chart
12. Average transaction size over time chart
13. Cumulative spend chart
14. Per-cardholder spending timeline and category breakdown

### Outlier Triage
15. Status bucket tabs with counts
16. Inline filters (type, severity, search) with debounced search
17. Sortable transaction table with severity badges
18. Detail modal with outlier context cards
19. Triage actions (Acknowledge, Investigate) with state persistence
20. Send receipt reminders via Extend API
21. Bulk actions with floating action bar
22. Export CSV of current filtered view

### Navigation & Interaction
23. Hash-based client-side routing with 5 pages
24. Global date range picker with presets and custom range
25. Period comparison toggle
26. Command palette (`Cmd+K`)
27. Keyboard shortcuts for navigation and table interaction
28. Keyboard shortcut help overlay

### Polish
29. No dead UI: every cursor:pointer element has a working handler
30. Responsive: sidebar collapses at 1024px, hides at 480px with hamburger
31. Loading states: skeleton loaders for charts and tables
32. Error states: user-friendly messages when fetches fail
33. Smooth page transitions
34. Active date range indicator in header

## Done When

All of the following are true:

**Data & API:**
- [ ] `fetch-data.py` retrieves 200-300 unique transactions from Extend API
- [ ] All READ endpoints return valid JSON: `/api/summary`, `/api/transactions`, `/api/trends`, `/api/categories`, `/api/top-spenders`, `/api/distribution`, `/api/day-of-week`, `/api/cardholder/:name`, `/api/comparison`
- [ ] Date range params (`from`, `to`) work on: `/api/summary`, `/api/transactions`, `/api/trends`, `/api/categories`, `/api/top-spenders`, `/api/distribution`, `/api/day-of-week`, `/api/comparison`
- [ ] `data/transactions.json` contains NO duplicate transaction IDs
- [ ] Outlier detection produces deterministic results

**Pages & Routing:**
- [ ] Hash routing works: `#/overview`, `#/trends`, `#/categories`, `#/cardholders`, `#/outliers`
- [ ] Default route (`/` or `#/`) redirects to `#/overview`
- [ ] Sidebar navigation links work and show active state
- [ ] Browser back/forward buttons work with hash routes
- [ ] Each page loads its own data and renders correctly

**Overview Page:**
- [ ] 4 summary cards with values AND period comparison deltas
- [ ] Sparkline trends in summary cards
- [ ] Spend over time chart with moving average
- [ ] Category breakdown chart
- [ ] Quick-view outlier table (latest 5 flagged) with link to Outliers page
- [ ] Recent activity feed (last 10 transactions)

**Trends Page:**
- [ ] Date range picker with presets (7d, 30d, 90d, All) and custom range inputs
- [ ] Changing date range updates all charts on the page
- [ ] Period comparison toggle shows dual-series charts when enabled
- [ ] Spend over time, daily count, avg transaction size, cumulative spend charts all render
- [ ] Day-of-week heatmap renders within the selected date range

**Categories Page:**
- [ ] Full category table with all categories (not just top 10)
- [ ] Category table shows: name, total spend, count, % of total, avg transaction, outlier count
- [ ] Category sparklines render in the table
- [ ] Clicking a category drills down to show its transactions
- [ ] Category bar chart renders

**Cardholders Page:**
- [ ] Cardholder table with sortable columns and search
- [ ] Clicking a cardholder expands their profile inline
- [ ] Profile shows: spending timeline chart, top categories chart, outlier history
- [ ] Quick action: send receipt reminders for cardholder's missing-receipt transactions

**Outliers Page:**
- [ ] Status bucket tabs with correct counts
- [ ] Inline filters work (type, severity, search)
- [ ] Table sorted by date descending, column headers toggle sort
- [ ] Row click opens detail modal with outlier context cards
- [ ] Triage actions persist to `data/triage.json` and move transactions between tabs
- [ ] Bulk actions work (Send Reminders, Acknowledge, Investigate)
- [ ] Export CSV exports current filtered view
- [ ] Refresh Data re-fetches from Extend API

**Cross-Cutting:**
- [ ] Command palette opens with Cmd+K / Ctrl+K
- [ ] Command palette searches pages, transactions, and actions
- [ ] Keyboard shortcuts work: `g o/t/c/h/l`, `j/k`, `Enter`, `Escape`, `?`
- [ ] Shortcut help overlay shows on `?`
- [ ] Date range persists across page navigation
- [ ] Active date range shown in header

**Polish:**
- [ ] No dead buttons: every cursor:pointer element has a working handler
- [ ] Responsive: sidebar collapses at 1024px, hides at 480px
- [ ] Loading skeletons for charts and tables
- [ ] Error states for failed fetches
- [ ] Toast notifications for all actions
- [ ] Smooth page transitions (fade or slide)

Output `<promise>COMPLETE</promise>` only when every checkbox above is verified.
