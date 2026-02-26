# Spec: Extend Expense Compliance Dashboard

## Goal

Build a production-quality expense compliance workflow tool that connects to the Extend API, detects policy violations across real transaction data, and enables admins to triage and act on findings. The dashboard matches Extend's design system and turns violation detection into an actionable workflow: flag, review, remind, resolve.

## Non-Goals

- No user-facing authentication — API access uses EXTEND_API_KEY and EXTEND_API_SECRET environment variables
- No database — file-based JSON storage only (review state stored in `data/reviews.json`)
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
- **Actions use Extend API:** receipt reminders call the real Extend API endpoint, not mocks

## Deliverables

When finished, these files must exist and work:

```
fetch-data.py           # Fetches paginated transactions from Extend API
server.js               # Express server: API endpoints + violation engine + actions + static files
public/index.html       # Complete dashboard UI (single file)
data/transactions.json  # Cached transaction data (200-300 unique records)
data/reviews.json       # Local review state (review_status per transaction ID)
package.json            # Node dependencies (express only)
```

## Features

### Data & Detection (unchanged from v1)
1. Fetch paginated transactions from Extend API using the `paywithextend` SDK
2. Five violation detection rules with severity levels (see specs/ARCHITECTURE.md)

### Summary & Charts
3. Summary cards: total spend, transaction count, violation count, compliance rate
4. Doughnut chart: violations by rule type
5. Bar chart: daily spend trend
6. Top offenders: card showing top 5 cardholders by violation count
7. ~~Violation trends line chart~~ — REMOVED (low value, reclaim space for table focus)

### Triage Table (primary workflow surface)
8. Status bucket tabs above the table: **Flagged** | **Under Review** | **Approved** | **All Transactions** — clicking a tab filters the table to that bucket. Flagged is the default tab. Each tab shows a count badge.
9. Inline filters below the tabs: rule type dropdown, severity dropdown, search box, date range — all in a single row directly above the table header. Ramp-style compact layout.
10. Table columns: Date, Merchant, Card, Card User, Receipts, Amount — matching Extend UI
11. Column header sorting: click to toggle ascending/descending with visual indicator
12. Severity badges (HIGH/MEDIUM/LOW) as colored pills on each row
13. Pagination: 25 rows per page with prev/next controls
14. Click a row to open detail modal

### Actions (NEW — the "so what")
15. **Send receipt reminder:** In the detail modal for any transaction with `receipt_missing`, a "Send Receipt Reminder" button calls the Extend API (`POST /api/actions/remind`). Shows loading state, success confirmation, or error. Also available as a bulk action: select multiple rows with checkboxes, click "Send Reminders" to batch-remind all selected missing-receipt transactions.
16. **Mark as reviewed:** In the detail modal, buttons to change review status: "Mark Under Review" and "Approve". This updates `data/reviews.json` locally and moves the transaction between status buckets. Reversible — can go back to Flagged.
17. **Draft follow-up message:** In the detail modal, a "Draft Follow-Up" button generates a templated message for the cardholder explaining which rules were violated and what action is needed (provide receipt, justify expense, etc.). Message is displayed in a copyable text area. Template is deterministic based on violation rules — not AI-generated.
18. **Bulk actions:** Checkbox column on the left side of the table. When rows are selected, a floating action bar appears above the table with: "Send Reminders (N)" for missing-receipt items, "Approve (N)", "Mark Under Review (N)". Counts reflect how many selected rows are eligible for each action.

### Export & Refresh
19. "Download CSV" button exports current filtered view
20. "Refresh Data" button re-fetches from Extend API without restarting server

### Polish
21. No dead UI: every element that looks clickable must do something (see specs/ARCHITECTURE.md)
22. Responsive: sidebar collapses at 768px, hides at 480px

## Done When

All of the following are true:

**Data & API:**
- [ ] `fetch-data.py` retrieves 200-300 unique transactions from Extend API
- [ ] `curl localhost:3000/api/summary` returns valid JSON with real numbers
- [ ] `curl localhost:3000/api/transactions?status=flagged` returns flagged transactions
- [ ] `curl localhost:3000/api/transactions?status=all` returns all transactions
- [ ] `curl localhost:3000/api/trends` returns daily spend data
- [ ] `curl localhost:3000/api/top-offenders` returns top 5 violators
- [ ] `data/transactions.json` contains NO duplicate transaction IDs

**Triage Table:**
- [ ] Status bucket tabs visible: Flagged (default), Under Review, Approved, All Transactions
- [ ] Each tab shows correct count badge
- [ ] Clicking a tab filters the table to that status
- [ ] Inline filters (rule, severity, search) work within the active tab
- [ ] Table sorted by date descending by default; column headers toggle sort
- [ ] Pagination works at 25 rows per page
- [ ] Clicking a row opens detail modal

**Actions:**
- [ ] Detail modal shows "Send Receipt Reminder" button for missing-receipt transactions
- [ ] Reminder button calls `POST /api/actions/remind` and shows success/error feedback
- [ ] Detail modal shows "Mark Under Review" and "Approve" buttons
- [ ] Review status changes persist to `data/reviews.json` and move transaction between tabs
- [ ] Detail modal shows "Draft Follow-Up" with copyable templated message
- [ ] Bulk select checkboxes appear in the table
- [ ] Selecting rows shows floating action bar with eligible action counts
- [ ] Bulk "Send Reminders" works for selected missing-receipt rows
- [ ] Bulk "Approve" and "Mark Under Review" work for selected rows

**Charts & Summary:**
- [ ] 4 summary cards visible (total spend, transactions, violations, compliance rate)
- [ ] Doughnut chart renders violations by rule type
- [ ] Bar chart renders daily spend trend
- [ ] Top offenders card shows up to 5 cardholders
- [ ] No violation trends chart (removed)

**Polish:**
- [ ] No dead buttons: every cursor:pointer element has a working handler
- [ ] Responsive: sidebar collapses at 768px, hides at 480px
- [ ] Visual match to Extend UI at 1280px
- [ ] "Download CSV" exports current view
- [ ] "Refresh Data" re-fetches and reloads UI

Output `<promise>COMPLETE</promise>` only when every checkbox above is verified.
