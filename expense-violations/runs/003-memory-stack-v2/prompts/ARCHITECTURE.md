# Architecture: Invariants and Constraints

This file defines the patterns and rules that **must not change** across iterations.
If you are tempted to refactor the architecture, STOP — read this file first.
Long runs fail when the agent reinvents architecture every hour. This file prevents that.

## System Topology

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ fetch-data.py│────▶│ data/             │────▶│ server.js       │
│ (Python)     │     │ transactions.json │     │ (Express:3000)  │
└──────────────┘     └──────────────────┘     │                 │
                                               │ ├─ /api/summary │
                                               │ ├─ /api/violations
                                               │ ├─ /api/trends  │
                                               │ ├─ /api/violation-trends
                                               │ ├─ /api/top-offenders
                                               │ ├─ /api/refresh │
                                               │ └─ /* (static)  │
                                               └────────┬────────┘
                                                        │
                                               ┌────────▼────────┐
                                               │ public/         │
                                               │ index.html      │
                                               │ (Chart.js CDN)  │
                                               └─────────────────┘
```

## Data Flow (DO NOT CHANGE)

1. `fetch-data.py` calls Extend API via `paywithextend` SDK → writes `data/transactions.json`
2. `server.js` reads JSON on startup → normalizes → detects violations → serves API
3. `public/index.html` fetches from `/api/*` → renders UI

Data flows in ONE direction. The frontend never writes. The server never calls Extend directly (except via the `/api/refresh` endpoint which shells out to `fetch-data.py`).

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

### GET /api/summary
```json
{
  "total_spend_cents": 5234856,
  "transaction_count": 283,
  "violation_count": 47,
  "compliance_rate": 83.4,
  "by_severity": { "HIGH": 22, "MEDIUM": 15, "LOW": 10 }
}
```

### GET /api/violations?rule=RULE_ID&severity=HIGH&page=1&limit=25&search=query
```json
{
  "violations": [ { ...transaction, "violations": [ { "rule_id": "...", "severity": "...", "description": "..." } ] } ],
  "total": 47,
  "page": 1,
  "pages": 2
}
```

### GET /api/trends
```json
[
  { "date": "2026-01-05", "amount_cents": 45670, "count": 12 },
  ...
]
```

### GET /api/violation-trends
```json
[
  { "date": "2026-01-05", "count": 3, "by_rule": { "WEEKEND_SPEND": 2, "MISSING_RECEIPT": 1 } },
  ...
]
```

### GET /api/top-offenders
```json
[
  { "cardholder": "John Doe", "violation_count": 8, "total_spend_cents": 125000, "top_rule": "MISSING_RECEIPT" },
  ...
]
```

### POST /api/refresh
Triggers a re-fetch from Extend API. Returns `{ "status": "ok", "transaction_count": 283 }` on success.

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

### Search/Filter Bar (EXACT)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Transaction Date ⓘ     🔍 Enter an amount, merchant name...   🔽 Receipt Tools ▼ ⬇ │
│ Jan 5, 2026 - Feb 4, 2026 ▼                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

- Date picker on left with calendar icon
- Search input in center
- Filter icon, "Receipt Tools" dropdown, download icon on right

### Table Default Sort

The violations table must be sorted by `date` descending (newest first) by default. Column headers should be clickable to toggle sort direction (ascending/descending) with a visual indicator showing the current sort column and direction.

### Table Columns (EXACT ORDER)

| # | Header | Internal Field | Display Notes |
|---|--------|---------------|---------------|
| 1 | Date | `date` | Format: "2/4/2026" |
| 2 | Merchant | `merchant` | With merchant category icon, show "RETAIL" below |
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
- Search input in the filter bar (filters the violations table)
- Filter dropdowns (rule type, severity)
- Download CSV button
- Refresh Data button
- Pagination controls (prev/next)
- Table row click (opens detail modal)
- Column header click (sorts table)

**Decorative elements (no click handler needed, but style them as static/non-interactive):**
- Sidebar nav items other than collapsible sections (Home, Activity, etc.) — render as static labels, NOT as clickable links with pointer cursor
- "Create New +" button — render as static/decorative, not as a clickable button
- Header search icon — decorative (real search is in the filter bar)
- User avatar/name — static display
- "Receipt Tools" dropdown — static label, not a functional dropdown
- Date range display — static label showing the data date range

**Rule:** If it has `cursor: pointer` and a hover state, it MUST have a click handler that does something. Otherwise use `cursor: default` and no hover effect.

## File Boundaries (CRITICAL)

| File | Responsibility | Must NOT contain |
|------|---------------|------------------|
| `fetch-data.py` | Extend API calls, pagination, JSON output | Violation logic, UI code, Express routes |
| `server.js` | Load data, normalize, detect violations, serve API, serve static | API calls to Extend (except /api/refresh), HTML/CSS |
| `public/index.html` | All UI: HTML structure, CSS styles, JS fetch/render logic | Node.js code, file system access, direct API calls to Extend |

Do not create additional files beyond these three (plus `package.json` and `data/transactions.json`).

## Error Handling Pattern

- **fetch-data.py:** Print errors to stderr with `flush=True`. Save partial results if any pages succeeded. Exit with non-zero code on total failure.
- **server.js:** Return `{ "error": "message" }` with appropriate HTTP status. Never crash on bad data — log and skip malformed records.
- **index.html:** Show user-friendly error messages in the UI. Never show raw JSON errors. Retry failed fetches once before showing error state.
