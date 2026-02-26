# Architecture: Invariants and Constraints

This file defines the patterns and rules that **must not change** across iterations.
If you are tempted to refactor the architecture, STOP — read this file first.
Long runs fail when the agent reinvents architecture every hour. This file prevents that.

## System Topology

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│ fetch-data.py│────▶│ data/             │────▶│ server.js            │
│ (Python)     │     │ transactions.json │     │ (Express:3000)       │
└──────────────┘     │ reviews.json      │◀───│                      │
                     └──────────────────┘     │ READ endpoints:      │
                                               │ ├─ /api/summary      │
                                               │ ├─ /api/transactions │
                                               │ ├─ /api/trends       │
                                               │ ├─ /api/top-offenders│
                                               │                      │
                                               │ WRITE endpoints:     │
                                               │ ├─ /api/actions/remind    │
                                               │ ├─ /api/actions/review    │
                                               │ ├─ /api/actions/bulk      │
                                               │ ├─ /api/refresh           │
                                               │ └─ /* (static)            │
                                               └────────┬─────────────┘
                                                        │
                                               ┌────────▼────────┐
                                               │ public/         │
                                               │ index.html      │
                                               │ (Chart.js CDN)  │
                                               └─────────────────┘
```

## Data Flow (DO NOT CHANGE)

1. `fetch-data.py` calls Extend API via `paywithextend` SDK → writes `data/transactions.json`
2. `server.js` reads JSON on startup → normalizes → detects violations → serves READ endpoints
3. WRITE endpoints mutate local state (`data/reviews.json`) or call Extend API (receipt reminders)
4. `public/index.html` fetches from `/api/*` → renders UI

Data flows in ONE direction for reads. The frontend never writes files. Write actions go through `/api/actions/*` endpoints only. The server calls Extend API in two places: `/api/refresh` (shells out to `fetch-data.py`) and `/api/actions/remind` (calls Extend receipt reminder API directly via HTTP).

## Extend API Access

- **SDK:** `paywithextend` Python package. Import: `from extend import ExtendClient`
- **Auth:** `BasicAuth(api_key, api_secret)` from `extend.auth`. Credentials come from `EXTEND_API_KEY` and `EXTEND_API_SECRET` environment variables.
- **Endpoint:** Transaction report endpoint (`https://apiv2.paywithextend.com/reports/transactions/v2`)
- **Amount fields:** Values are in cents (verify from actual response)

## Pagination Strategy (FROZEN)

The Extend API paginates transaction reports. The response shape is:

```json
{
  "report": {
    "page": 1,
    "perPage": 25,
    "count": 26,
    "transactions": [...]
  }
}
```

**Pagination logic in `fetch-data.py`:**

1. Request page 1
2. If `count > perPage`, there are more pages — request the next page
3. Continue until `count <= perPage` (no more pages) or you've fetched all pages
4. Concatenate all transactions into a single list
5. **OVERWRITE** `data/transactions.json` with the complete result — never append to an existing file

**CRITICAL:** Every run of `fetch-data.py` must produce a fresh, complete file. If the script is called again (e.g., via `/api/refresh`), it replaces the old file entirely. Appending would create duplicates.

Deduplication is NOT needed — the API returns unique records per page.

This logic lives in `fetch-data.py` and nowhere else.

## Transaction Schema (FROZEN)

Normalize Extend API fields to this internal shape. All code must use these field names:

```javascript
{
  id: String,              // Extend: id
  merchant: String,        // Extend: merchantName
  amount_cents: Number,    // Extend: authBillingAmountCents
  date: String,            // Extend: authedAt (ISO 8601)
  virtual_card_id: String, // Extend: virtualCardId
  vcn_display_name: String,// Extend: vcnDisplayName
  vcn_last4: String,       // Extend: vcnLast4
  cardholder: String,      // Extend: recipientName
  mcc: String,             // Extend: mcc
  receipt_missing: Boolean, // Extend: !hasAttachments || attachmentsCount === 0
  status: String           // Extend: status (CLEARED, PENDING, DECLINED, etc.)
}
```

**If the Extend API returns different field names than expected**, update the normalization mapping in `server.js` — but KEEP the internal field names above unchanged. Every other file depends on them.

## Violation Rules (FROZEN)

| ID | Name | Condition | Severity |
|----|------|-----------|----------|
| `DUPLICATE_MERCHANT` | Duplicate merchant | Same `merchant` + `cardholder` within 24 hours | HIGH |
| `ROUND_AMOUNT` | Round amount | `amount_cents % 100 === 0` AND `amount_cents > 10000` | MEDIUM |
| `WEEKEND_SPEND` | Weekend spend | Day of week is Saturday (6) or Sunday (0) | LOW |
| `MISSING_RECEIPT` | Missing receipt | `receipt_missing === true` AND `amount_cents > 2500` | HIGH |
| `HIGH_VELOCITY` | High velocity | >5 transactions on same `virtual_card_id` in one calendar day | MEDIUM |

Each violation object looks like:

```javascript
{
  rule_id: "DUPLICATE_MERCHANT",
  severity: "HIGH",
  description: "Same merchant charged by same cardholder within 24 hours"
}
```

A transaction can have multiple violations. The `violations` array is attached to each flagged transaction in the API response.

**Do not add new violation rules.** The five above are the complete set.

## API Contract (FROZEN)

### READ Endpoints

#### GET /api/summary
```json
{
  "total_spend_cents": 5234856,
  "transaction_count": 283,
  "violation_count": 47,
  "compliance_rate": 83.4,
  "by_severity": { "HIGH": 22, "MEDIUM": 15, "LOW": 10 },
  "by_review_status": { "flagged": 42, "under_review": 3, "approved": 2 }
}
```

#### GET /api/transactions?status=flagged&rule=RULE_ID&severity=HIGH&page=1&limit=25&search=query

Replaces the old `/api/violations` endpoint. Returns ALL transactions (not just flagged ones) with a `status` filter.

**Query params:**
- `status`: `flagged` (default) | `under_review` | `approved` | `all`
- `rule`: filter by violation rule ID (only applies when status includes flagged transactions)
- `severity`: filter by violation severity
- `search`: case-insensitive substring match on merchant, cardholder, card name, amount
- `page`: page number (default 1)
- `limit`: rows per page (default 25, max 100)
- `sort`: field name to sort by (default `date`)
- `order`: `asc` or `desc` (default `desc`)

```json
{
  "transactions": [
    {
      ...transaction,
      "violations": [ { "rule_id": "...", "severity": "...", "description": "..." } ],
      "review_status": "flagged",
      "review_updated_at": null
    }
  ],
  "total": 47,
  "page": 1,
  "pages": 2,
  "counts": { "flagged": 42, "under_review": 3, "approved": 2, "all": 283 }
}
```

**`review_status` logic:**
- Transactions with violations default to `"flagged"` unless overridden in `data/reviews.json`
- Transactions without violations have `review_status: null` (shown only under "All Transactions" tab)
- `data/reviews.json` stores `{ "txn_id": { "status": "approved", "updated_at": "ISO8601" } }`

#### GET /api/trends
```json
[
  { "date": "2026-01-05", "amount_cents": 45670, "count": 12 },
  ...
]
```

#### GET /api/top-offenders
```json
[
  { "cardholder": "John Doe", "violation_count": 8, "total_spend_cents": 125000, "top_rule": "MISSING_RECEIPT" },
  ...
]
```

**REMOVED:** `/api/violation-trends` — dropped per v2 spec. Do not implement.

### WRITE Endpoints

#### POST /api/actions/remind
Request: `{ "transaction_id": "..." }`. Verify transaction exists and has `receipt_missing === true`, then call Extend API: `POST https://apiv2.paywithextend.com/transactions/{id}/reminders`. Return `{ "status": "ok" }` or `{ "error": "..." }`.

#### POST /api/actions/review
Request: `{ "transaction_id": "...", "review_status": "flagged|under_review|approved" }`. Validate transaction ID exists. Update `data/reviews.json`. Local-only — no Extend API call.

#### POST /api/actions/bulk
Request: `{ "action": "remind|review", "transaction_ids": [...], "review_status": "..." }`. Validate each transaction ID exists. Loop and perform action per item. Return `{ "status": "ok|partial", "results": [...], "failed": [...] }` with per-item status.

#### POST /api/refresh
Shell out to `fetch-data.py`, reload data. Does NOT clear `data/reviews.json`. Return `{ "status": "ok", "transaction_count": N }`.

## Review State Model

Review status is stored in `data/reviews.json` as a simple map:

```json
{
  "txn_abc123": { "status": "approved", "updated_at": "2026-02-12T10:30:00Z" },
  "txn_def456": { "status": "under_review", "updated_at": "2026-02-12T10:31:00Z" }
}
```

**Rules:**
- Only transactions WITH violations can have a review status
- Default review status for flagged transactions is `"flagged"` (not stored in the file — absence means flagged)
- Valid transitions: `flagged → under_review → approved`, `approved → flagged` (reversible)
- `data/reviews.json` is loaded on server startup and kept in memory. Writes are synchronous (write-through).
- If a transaction ID in `reviews.json` no longer exists in `transactions.json` after a refresh, ignore it (stale entries are harmless)

## Follow-Up Message Templates

The detail modal "Draft Follow-Up" button generates a deterministic message (NOT AI-generated) built client-side from violation data. Template includes: subject line with date, greeting with cardholder name, list of violations, per-rule action items (MISSING_RECEIPT → upload receipt, DUPLICATE_MERCHANT → confirm both valid, ROUND_AMOUNT → provide justification, WEEKEND_SPEND → confirm business expense, HIGH_VELOCITY → no action if legitimate), 5 business day deadline.

## UI Design (FROZEN)

### Theme & Color Palette

**Theme:** Light (NOT dark!)

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#ffffff` | Page background |
| Sidebar | `#f8fafc` | Sidebar background |
| Cards | `#ffffff` | Card/container background with subtle shadow |
| Primary accent | `#10b981` | Teal/green — buttons, active states |
| Text primary | `#1e293b` | Dark slate — headings, body text |
| Text secondary | `#64748b` | Muted gray — labels, secondary info |
| Border | `#e2e8f0` | Light border — table rows, card edges |
| Status Active | `#10b981` | Green |
| Status Pending | `#6b7280` | Gray |
| Status Declined | `#ef4444` | Red |
| Status Cancelled | `#f97316` | Orange |
| Status Reversal | `#ef4444` | Red |
| Amount negative | `#ef4444` | Red — declined/reversal amounts |

### Typography

- Font: `system-ui, -apple-system, sans-serif`
- Headers: 600 weight
- Body: 400 weight

### Components

- **Sidebar:** ~240px wide, icons + text, active item has teal left border
- **Tables:** subtle row borders, hover states, right-aligned amounts
- **Badges:** rounded pills, ~6px padding, small text
- **Buttons:** rounded corners, teal for primary actions

### Sidebar Navigation (EXACT STRUCTURE)

```
┌─────────────────────────┐
│ 🟢 Extend Enterprise... │  ← Logo + org name
├─────────────────────────┤
│ 🏠 Home                 │
│ 🔔 Activity        99+  │  ← Notification badge
│ ⚡ AI Agent             │
│ 👤 My Wallet         ▼  │  ← Collapsible
│    └─ Cards             │
│    └─ Budgets           │
│    └─ Transactions      │
│    └─ Reimbursements    │
│ 👥 Manager Review    ▼  │  ← Collapsible
│ 💳 Cards             ▼  │  ← Collapsible
│    └─ Physical Cards    │
│    └─ Virtual Cards     │
│    └─ Bill Pay Cards    │
│ 💰 Budgets              │
│ 💵 Card Transactions ◀  │  ← Active (teal)
├─────────────────────────┤
│ 🏛️ Accounting        ▼  │  ← Collapsible
│    └─ Card Transactions │
│    └─ Statements        │
│ 👥 People               │
│ 📈 Insights             │
├─────────────────────────┤
│ ⚙️ Settings             │
│ ❓ Help & Support       │
│ 🟢 extend               │  ← Logo at bottom
└─────────────────────────┘
```

### Header Layout (EXACT)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Extend Logo]  Card Transactions          [Create New +] 🔍 [JB ▼]  │
│                                                          Card Manager│
└──────────────────────────────────────────────────────────────────────┘
```

- Left: Extend logo (teal icon + "Extend Enterprise...")
- Center-left: Page title "Card Transactions" (large, bold)
- Right: "Create New +" button (teal, rounded), search icon, user avatar with name

### Triage Table Layout (v2 — replaces old filter bar + violations table)

The table is now the primary workflow surface. Layout from top to bottom:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Flagged (42)]  [Under Review (3)]  [Approved (2)]  [All Transactions] │  ← Status bucket tabs
├─────────────────────────────────────────────────────────────────────────┤
│ Rule ▼  │  Severity ▼  │  🔍 Search...  │  Export CSV ⬇  │  Refresh 🔄 │  ← Inline filters (single row)
├──┬──────────────────────────────────────────────────────────────────────┤
│☐ │ Date ▼ │ Merchant │ Card │ Card User │ Receipts │ Amount           │  ← Table header with checkbox
├──┼──────────────────────────────────────────────────────────────────────┤
│☐ │ ...    │ ...      │ ...  │ ...       │ ...      │ ...              │  ← Data rows
├──┴──────────────────────────────────────────────────────────────────────┤
│ ┌─ Floating action bar (appears when rows selected) ─────────────────┐ │
│ │ 3 selected  │  Send Reminders (2)  │  Approve (3)  │  Under Review │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│ ◀ Previous  │  Page 1 of 9 (201 results)  │  Next ▶                   │  ← Pagination
└─────────────────────────────────────────────────────────────────────────┘
```

**Status bucket tabs:**
- Horizontal tabs directly above the inline filters
- Each tab shows its count in parentheses: "Flagged (42)"
- Active tab has teal bottom border and bold text
- Clicking a tab sets the `status` query param and reloads the table
- "Flagged" is the default active tab on page load
- "All Transactions" shows everything (including non-flagged transactions with no violations)

**Inline filters:**
- Single row, compact, directly above the table header
- Left to right: Rule dropdown, Severity dropdown, Search input (with magnifying glass icon), Export CSV button, Refresh Data button
- Filters apply within the active status bucket tab
- Search is debounced (300ms)
- Rule and Severity dropdowns only visible on Flagged and All tabs (hidden on Under Review / Approved since those are already filtered)

**Checkbox column:**
- First column in the table, narrow (32px)
- Header row has a "select all on page" checkbox
- Each data row has a checkbox
- Selecting one or more rows shows the floating action bar
- Deselecting all rows hides the floating action bar

**Floating action bar:**
- Appears between the table body and pagination when ≥1 row is selected
- Shows: "{N} selected" count, then action buttons
- "Send Reminders (N)" — count is how many selected rows have `receipt_missing === true`. Disabled (grayed) if count is 0.
- "Approve (N)" — count is how many selected rows. Always enabled when rows selected.
- "Mark Under Review (N)" — same.
- Buttons use teal for primary (Send Reminders), gray/outline for others
- After an action completes, deselect all rows, hide the bar, reload the table

### Table Default Sort

The table must be sorted by `date` descending (newest first) by default. Column headers should be clickable to toggle sort direction (ascending/descending) with a visual indicator showing the current sort column and direction.

### Table Columns (EXACT ORDER)

| # | Header | Internal Field | Display Notes |
|---|--------|---------------|---------------|
| 0 | ☐ | (checkbox) | Select row for bulk actions. 32px wide. |
| 1 | Date | `date` | Format: "Feb 4, 2026" |
| 2 | Merchant | `merchant` | With merchant category icon, show MCC group below |
| 3 | Card | `vcn_display_name` | Show card name, with `vcn_last4` below in gray |
| 4 | Card User | `cardholder` | User's name |
| 5 | Receipts | `receipt_missing` | Flag/document icon, not checkmark |
| 6 | Amount | `amount_cents` | Right-aligned, format as USD, status badge below |

### Amount Cell (EXACT)

```
For positive/cleared:          For declined:           For reversal:
┌────────────┐                ┌────────────┐          ┌────────────┐
│     $21.78 │ (black)        │     $21.78 │ (red)    │    -$1.98  │ (red)
│   Pending  │ (gray pill)    │   Declined │ (red)    │   Reversal │ (red pill)
└────────────┘                └────────────┘          └────────────┘
```

### Receipt Column Icon

Use a FLAG/DOCUMENT icon (not checkmark):
- Has receipt: Gray flag icon
- Missing receipt: Empty or highlighted flag
- Extend uses: `<svg>` flag/bookmark style icon

## Cosmetic vs Functional UI Elements

Every visible interactive element (button, dropdown, link) must either do something or not exist. Do NOT render non-functional elements that look clickable — this makes the app feel broken.

**Elements that MUST be functional:**
- Sidebar collapsible sections (expand/collapse submenus)
- Status bucket tabs (switch between Flagged / Under Review / Approved / All)
- Search input in the inline filters (filters the table)
- Filter dropdowns (rule type, severity)
- Download CSV button
- Refresh Data button
- Pagination controls (prev/next)
- Table row click (opens detail modal)
- Column header click (sorts table)
- Row checkboxes (select for bulk actions)
- "Select all" checkbox in header
- Floating action bar buttons (Send Reminders, Approve, Mark Under Review)
- Detail modal: "Send Receipt Reminder" button (calls Extend API)
- Detail modal: "Mark Under Review" / "Approve" buttons (update review status)
- Detail modal: "Draft Follow-Up" button (generates copyable message)

**Decorative elements (no click handler needed, but style them as static/non-interactive):**
- Sidebar nav items other than collapsible sections (Home, Activity, etc.)
- "Create New +" button — static/decorative
- Header search icon — decorative (real search is in the inline filters)
- User avatar/name — static display

**Rule:** If it has `cursor: pointer` and a hover state, it MUST have a click handler that does something. Otherwise use `cursor: default` and no hover effect.

## File Boundaries (CRITICAL)

| File | Responsibility | Must NOT contain |
|------|---------------|------------------|
| `fetch-data.py` | Extend API calls, pagination, JSON output | Violation logic, UI code, Express routes |
| `server.js` | Load data, normalize, detect violations, serve READ + WRITE API, serve static, manage reviews.json | HTML/CSS |
| `public/index.html` | All UI: HTML structure, CSS styles, JS fetch/render logic, follow-up message templates | Node.js code, file system access, direct API calls to Extend |

**Allowed files:** `fetch-data.py`, `server.js`, `public/index.html`, `package.json`, `data/transactions.json`, `data/reviews.json`.

**Note on Extend API calls in server.js:** The server now makes direct HTTP calls to the Extend API in two places: (1) `/api/refresh` shells out to `fetch-data.py`, (2) `/api/actions/remind` calls the Extend receipt reminder endpoint via HTTP. This is the only exception to the "server doesn't call Extend" rule. Use the `node-fetch` package or Node's built-in `fetch` (Node 18+) — do NOT add axios or other HTTP libraries.

## Error Handling Pattern

- **fetch-data.py:** Print errors to stderr with `flush=True`. Save partial results if any pages succeeded. Exit with non-zero code on total failure.
- **server.js:** Return `{ "error": "message" }` with appropriate HTTP status. Never crash on bad data — log and skip malformed records.
- **index.html:** Show user-friendly error messages in the UI. Never show raw JSON errors. Retry failed fetches once before showing error state.
