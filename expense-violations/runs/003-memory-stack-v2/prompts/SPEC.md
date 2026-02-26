# Spec: Extend Expense Compliance Dashboard

## Goal

Build a production-quality expense policy violation dashboard that connects to the Extend API, detects compliance violations across real transaction data, and presents findings in a UI that matches Extend's design system. Features include drill-down views, interactive filtering, violation severity scoring, exportable reports, and real-time data refresh.

## Non-Goals

- No user-facing authentication — API access uses EXTEND_API_KEY and EXTEND_API_SECRET environment variables
- No database — file-based JSON storage only
- No build toolchain — no webpack, no TypeScript, no React
- No mock data — all data comes from the live Extend API
- No deployment — local development server only
- Do not invent new violation rules beyond what is specified below

## Hard Constraints

- **Single-page app:** one `public/index.html` file, vanilla JS, Chart.js via CDN
- **No build step:** the app must work by opening `index.html` or running `node server.js`
- **Express on port 3000:** one `server.js` file handles API + static serving
- **Python data fetch:** one `fetch-data.py` script using `paywithextend` SDK
- **Light theme only:** match Extend's production UI (white background, teal accents)
- **Real field names:** use exact Extend API field names discovered at runtime, never guess
- **Deterministic violations:** same input data must always produce same violation results

## Deliverables

When finished, these files must exist and work:

```
fetch-data.py           # Fetches paginated transactions from Extend API
server.js               # Express server: API endpoints + violation engine + static files
public/index.html       # Complete dashboard UI (600+ lines, single file)
data/transactions.json  # Cached transaction data (200-300 unique records)
package.json            # Node dependencies (express only)
```

## Features

1. Fetch paginated transactions from Extend API using the `paywithextend` SDK
2. Five violation detection rules with severity levels (see specs/ARCHITECTURE.md)
3. Summary cards: total spend, transaction count, violation count, compliance rate
4. Doughnut chart: violations by rule type
5. Bar chart: daily spend trend (last 30 days)
6. Violations table with all columns matching Extend UI, sorted by date descending by default
7. Column header sorting: clicking a column header sorts the table by that column, toggling ascending/descending
8. Severity scoring: each violation has a severity (HIGH / MEDIUM / LOW), displayed as colored badges
8. Drill-down modal: clicking a violation row opens a detail panel showing all transaction fields and which rules fired
9. Interactive filters: filter violations table by rule type, severity, date range, merchant
10. Search: real-time search across merchant name, cardholder, card name, amount
11. Export: "Download CSV" button exports current filtered view as CSV
12. Data refresh: "Refresh Data" button re-fetches from Extend API without restarting server
13. Violation trends: line chart showing violation count per day over time
14. Top offenders: card showing top 5 cardholders by violation count
15. Pagination: violations table paginates at 25 rows per page with prev/next controls
16. No dead UI: every element that looks clickable must actually do something (see specs/ARCHITECTURE.md "Cosmetic vs Functional UI Elements")

## Done When

All of the following are true:
- [ ] `fetch-data.py` retrieves 200-300 unique transactions from Extend API
- [ ] `curl localhost:3000/api/summary` returns valid JSON with real numbers
- [ ] `curl localhost:3000/api/violations` returns flagged transactions with severity
- [ ] `curl localhost:3000/api/trends` returns daily spend data
- [ ] `curl localhost:3000/api/violation-trends` returns daily violation counts
- [ ] `curl localhost:3000/api/top-offenders` returns top 5 violators
- [ ] Dashboard renders at 1280px with: sidebar, header, summary cards, 3 charts, filters, table
- [ ] Severity badges (HIGH/MEDIUM/LOW) visible on violation rows with correct colors
- [ ] Top Offenders card visible, showing up to 5 cardholders with violation counts
- [ ] Violation trends line chart renders with data points over time
- [ ] Clicking a violation row opens detail modal with full transaction info
- [ ] Filter dropdowns narrow the violations table correctly
- [ ] Search box filters table in real-time
- [ ] "Download CSV" exports current view
- [ ] "Refresh Data" button triggers API re-fetch and UI update
- [ ] Table paginates at 25 rows with working prev/next
- [ ] Table sorted by date descending by default; clicking column headers changes sort
- [ ] No dead buttons: every element with cursor:pointer has a working click handler
- [ ] `data/transactions.json` contains NO duplicate transaction IDs
- [ ] Responsive: sidebar collapses at 768px, hides at 480px
- [ ] Visual match to Extend UI: 90%+ fidelity at 1280px (verify with Playwright screenshot)

Output `<promise>COMPLETE</promise>` only when every checkbox above is verified.
