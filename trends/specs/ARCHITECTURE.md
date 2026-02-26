# Architecture: Invariants and Constraints

This file defines the patterns and rules that **must not change** across iterations.
If you are tempted to refactor the architecture, STOP — read this file first.
Long runs fail when the agent reinvents architecture every hour. This file prevents that.

## System Topology

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│ fetch-data.py│────▶│ data/             │────▶│ server.js                │
│ (Python)     │     │ transactions.json │     │ (Express:3000)           │
└──────────────┘     │ triage.json       │◀───│                          │
                     └──────────────────┘     │ READ endpoints:          │
                                               │ ├─ /api/summary          │
                                               │ ├─ /api/transactions     │
                                               │ ├─ /api/trends           │
                                               │ ├─ /api/categories       │
                                               │ ├─ /api/top-spenders     │
                                               │ ├─ /api/distribution     │
                                               │ ├─ /api/day-of-week      │
                                               │                          │
                                               │ WRITE endpoints:         │
                                               │ ├─ /api/actions/remind   │
                                               │ ├─ /api/actions/triage   │
                                               │ ├─ /api/actions/bulk     │
                                               │ ├─ /api/refresh          │
                                               │ └─ /* (static)           │
                                               └────────┬────────────────┘
                                                        │
                                               ┌────────▼────────┐
                                               │ public/         │
                                               │ index.html      │
                                               │ (Chart.js CDN)  │
                                               └─────────────────┘
```

## Data Flow (DO NOT CHANGE)

1. `fetch-data.py` calls Extend API via `paywithextend` SDK → writes `data/transactions.json`
2. `server.js` reads JSON on startup → normalizes → computes trend baselines → detects outliers → serves READ endpoints
3. WRITE endpoints mutate local state (`data/triage.json`) or call Extend API (receipt reminders)
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
  mcc_group: String,       // Extend: mccGroup (e.g., RETAIL, UTILITIES, BUSINESS)
  receipt_missing: Boolean, // Extend: !hasAttachments || attachmentsCount === 0
  status: String           // Extend: status (CLEARED, PENDING, DECLINED, etc.)
}
```

**If the Extend API returns different field names than expected**, update the normalization mapping in `server.js` — but KEEP the internal field names above unchanged. Every other file depends on them.

## Outlier Detection Rules (FROZEN)

Outlier detection is trend-based and statistical. The server computes baselines from the full transaction dataset, then flags individual transactions that deviate significantly.

| ID | Name | Condition | Severity | Context String |
|----|------|-----------|----------|----------------|
| `AMOUNT_OUTLIER` | Unusual amount | Transaction amount > cardholder's mean + 2x std dev (min 5 txns for baseline) | HIGH | "This transaction ($X) is Yx the cardholder's average ($Z)" |
| `CATEGORY_SPIKE` | Category spike | Single transaction > 50% of that MCC group's total spend for the period | HIGH | "This transaction is X% of all [category] spend ($Y total)" |
| `VELOCITY_SPIKE` | Spending velocity spike | Cardholder's daily spend > 3x their average daily spend (min 3 active days for baseline) | MEDIUM | "Daily spend of $X is Yx the cardholder's average daily spend ($Z)" |
| `NEW_MERCHANT` | New merchant, large amount | First transaction with this merchant for this cardholder AND amount > $100 | MEDIUM | "First purchase from [merchant] by [cardholder] — $X" |
| `WEEKEND_LARGE` | Large weekend transaction | Weekend transaction AND amount > cardholder's median transaction | LOW | "Weekend transaction of $X exceeds median of $Y" |
| `MISSING_RECEIPT_HIGH` | Missing receipt, high value | `receipt_missing === true` AND `amount_cents > 5000` ($50+) | HIGH | "No receipt attached for $X transaction" |

Each outlier object looks like:

```javascript
{
  rule_id: "AMOUNT_OUTLIER",
  severity: "HIGH",
  description: "Unusual amount for this cardholder",
  context: "This transaction ($847.00) is 3.2x the cardholder's average ($265.00)"
}
```

A transaction can have multiple outliers. The `outliers` array is attached to each flagged transaction in the API response.

**Baseline computation:**
- Baselines are computed once when data is loaded (on startup and after refresh)
- Per-cardholder stats: mean, std dev, median, average daily spend, active days count
- Per-category stats: total spend per MCC group
- Per-cardholder-merchant stats: set of merchants seen
- Transactions with insufficient baseline data (< 5 txns for AMOUNT_OUTLIER, < 3 active days for VELOCITY_SPIKE) are NOT flagged by that rule — skip silently

**Do not add new outlier rules.** The six above are the complete set.

## API Contract (FROZEN)

### Date Range Filtering

All READ endpoints (except `/api/transactions` which has its own params) accept optional `from` and `to` query parameters:
- `from`: ISO 8601 date string (e.g., `2026-01-15`). Include transactions on or after this date.
- `to`: ISO 8601 date string (e.g., `2026-02-15`). Include transactions on or before this date.
- If omitted, all transactions are included (no date filter).
- The server filters the normalized transaction list by `date` field before computing aggregates.

### READ Endpoints

#### GET /api/summary?from=&to=
```json
{
  "total_spend_cents": 5234856,
  "transaction_count": 283,
  "outlier_count": 47,
  "avg_transaction_cents": 18497,
  "by_severity": { "HIGH": 22, "MEDIUM": 15, "LOW": 10 },
  "by_triage_status": { "flagged": 42, "acknowledged": 3, "investigating": 2 },
  "sparklines": {
    "spend": [12000, 15000, 8000, 22000, 18000, 9000, 14000],
    "count": [5, 8, 3, 11, 7, 4, 6],
    "outliers": [2, 3, 1, 5, 3, 2, 4],
    "avg": [2400, 1875, 2667, 2000, 2571, 2250, 2333]
  }
}
```

`sparklines` contains the last 7 data points (days) for each metric, used to render mini trend lines in the summary cards. When date range is applied, the sparklines cover the last 7 days of the filtered range.

#### GET /api/comparison?from=&to=
```json
{
  "current": {
    "total_spend_cents": 5234856,
    "transaction_count": 283,
    "outlier_count": 47,
    "avg_transaction_cents": 18497
  },
  "previous": {
    "total_spend_cents": 4890000,
    "transaction_count": 265,
    "outlier_count": 52,
    "avg_transaction_cents": 18453
  },
  "deltas": {
    "total_spend_pct": 7.05,
    "transaction_count_pct": 6.79,
    "outlier_count_pct": -9.62,
    "avg_transaction_pct": 0.24
  }
}
```

If `from`/`to` define a 30-day range, the "previous" period is the 30 days before `from`. If no date range, compare the most recent half of the data to the first half. `deltas` are percentage changes (positive = increase).

#### GET /api/transactions?status=flagged&rule=RULE_ID&severity=HIGH&page=1&limit=25&search=query&from=&to=

Returns ALL transactions (not just flagged ones) with a `status` filter.

**Query params:**
- `status`: `flagged` (default) | `acknowledged` | `investigating` | `all`
- `rule`: filter by outlier rule ID (only applies when status includes flagged transactions)
- `severity`: filter by outlier severity
- `search`: case-insensitive substring match on merchant, cardholder, card name, amount
- `page`: page number (default 1)
- `limit`: rows per page (default 25, max 100)
- `sort`: field name to sort by (default `date`)
- `order`: `asc` or `desc` (default `desc`)
- `from` / `to`: date range filter
- `category`: filter by mcc_group (used for category drill-down)

```json
{
  "transactions": [
    {
      ...transaction,
      "outliers": [ { "rule_id": "...", "severity": "...", "description": "...", "context": "..." } ],
      "triage_status": "flagged",
      "triage_updated_at": null
    }
  ],
  "total": 47,
  "page": 1,
  "pages": 2,
  "counts": { "flagged": 42, "acknowledged": 3, "investigating": 2, "all": 283 }
}
```

**`triage_status` logic:**
- Transactions with outliers default to `"flagged"` unless overridden in `data/triage.json`
- Transactions without outliers have `triage_status: null` (shown only under "All Transactions" tab)
- `data/triage.json` stores `{ "txn_id": { "status": "acknowledged", "updated_at": "ISO8601" } }`

#### GET /api/trends?from=&to=
```json
[
  { "date": "2026-01-05", "amount_cents": 45670, "count": 12, "moving_avg_cents": 42100, "cumulative_cents": 245670 },
  ...
]
```

`moving_avg_cents` is a 7-day trailing moving average. `cumulative_cents` is the running total of spend from the start of the range. For days with fewer than 7 prior days, average whatever is available.

#### GET /api/categories?from=&to=&all=true
```json
[
  { "mcc_group": "RETAIL", "amount_cents": 1250000, "count": 45, "pct_of_total": 23.8, "avg_cents": 27778, "outlier_count": 5, "sparkline": [45000, 52000, 38000, 61000, 44000, 55000, 40000] },
  ...
]
```

By default returns top 10 categories sorted by spend descending. With `all=true`, returns ALL categories (for the Categories page). `pct_of_total` is percentage of total spend. `sparkline` is last 7 days of spend for that category. `outlier_count` is count of outlier transactions in that category.

#### GET /api/top-spenders?from=&to=
```json
[
  { "cardholder": "John Doe", "total_spend_cents": 125000, "transaction_count": 28, "outlier_count": 4, "top_category": "RETAIL" },
  ...
]
```

Returns top 5 cardholders by total spend.

#### GET /api/cardholder/:name?from=&to=
```json
{
  "cardholder": "John Doe",
  "total_spend_cents": 125000,
  "transaction_count": 28,
  "outlier_count": 4,
  "avg_transaction_cents": 4464,
  "top_categories": [
    { "mcc_group": "RETAIL", "amount_cents": 55000, "count": 12 },
    { "mcc_group": "RESTAURANTS", "amount_cents": 35000, "count": 8 }
  ],
  "spending_timeline": [
    { "date": "2026-01-05", "amount_cents": 4500 },
    { "date": "2026-01-08", "amount_cents": 12000 },
    ...
  ],
  "outlier_transactions": [
    {
      ...transaction,
      "outliers": [...]
    }
  ],
  "missing_receipt_transactions": [
    { "id": "...", "merchant": "...", "amount_cents": 8500, "date": "..." }
  ]
}
```

`:name` is URL-encoded cardholder name. Returns the full profile for that cardholder. `spending_timeline` is all their transactions sorted by date. `outlier_transactions` are their flagged transactions with outlier details. `missing_receipt_transactions` are transactions where `receipt_missing === true`.

#### GET /api/distribution?from=&to=
```json
[
  { "bucket": "$0-25", "min_cents": 0, "max_cents": 2500, "count": 45, "total_cents": 56000 },
  { "bucket": "$25-50", "min_cents": 2500, "max_cents": 5000, "count": 38, "total_cents": 142000 },
  { "bucket": "$50-100", "min_cents": 5000, "max_cents": 10000, "count": 52, "total_cents": 385000 },
  { "bucket": "$100-250", "min_cents": 10000, "max_cents": 25000, "count": 28, "total_cents": 420000 },
  { "bucket": "$250-500", "min_cents": 25000, "max_cents": 50000, "count": 12, "total_cents": 390000 },
  { "bucket": "$500+", "min_cents": 50000, "max_cents": null, "count": 5, "total_cents": 310000 }
]
```

#### GET /api/day-of-week?from=&to=
```json
[
  { "day": 0, "day_name": "Sunday", "avg_spend_cents": 15200, "transaction_count": 18, "total_cents": 273600 },
  { "day": 1, "day_name": "Monday", "avg_spend_cents": 28400, "transaction_count": 52, "total_cents": 1476800 },
  ...
]
```

Days 0-6 (Sunday-Saturday). `avg_spend_cents` is average spend per transaction on that day of week.

### WRITE Endpoints

#### POST /api/actions/remind
Request: `{ "transaction_id": "..." }`. Verify transaction exists and has `receipt_missing === true`, then call Extend API: `POST https://apiv2.paywithextend.com/transactions/{id}/reminders`. Return `{ "status": "ok" }` or `{ "error": "..." }`.

#### POST /api/actions/triage
Request: `{ "transaction_id": "...", "triage_status": "flagged|acknowledged|investigating" }`. Validate transaction ID exists. Update `data/triage.json`. Local-only — no Extend API call.

#### POST /api/actions/bulk
Request: `{ "action": "remind|triage", "transaction_ids": [...], "triage_status": "..." }`. Validate each transaction ID exists. Loop and perform action per item. Return `{ "status": "ok|partial", "results": [...], "failed": [...] }` with per-item status.

#### POST /api/refresh
Shell out to `fetch-data.py`, reload data, recompute baselines. Does NOT clear `data/triage.json`. Return `{ "status": "ok", "transaction_count": N }`.

## Triage State Model

Triage status is stored in `data/triage.json` as a simple map:

```json
{
  "txn_abc123": { "status": "acknowledged", "updated_at": "2026-02-12T10:30:00Z" },
  "txn_def456": { "status": "investigating", "updated_at": "2026-02-12T10:31:00Z" }
}
```

**Rules:**
- Only transactions WITH outliers can have a triage status
- Default triage status for outlier transactions is `"flagged"` (not stored in the file — absence means flagged)
- Valid transitions: `flagged → acknowledged → investigating`, `investigating → flagged` (reversible)
- `data/triage.json` is loaded on server startup and kept in memory. Writes are synchronous (write-through).
- If a transaction ID in `triage.json` no longer exists in `transactions.json` after a refresh, ignore it (stale entries are harmless)

## UI Design

### Creative Brief

**Inspiration:** Linear, Ramp, Vercel, Mercury — the best modern fintech and developer tools. These products share a sensibility: dark or muted palettes, confident typography, generous whitespace, subtle gradients and glows, and a sense of quiet density where a lot of information is presented without feeling cluttered.

**Goal:** This should look and feel like a real product — not a Bootstrap admin template, not a Tailwind demo, not a generic dashboard. It should feel like something a design-forward fintech company shipped. You have full creative freedom on the visual approach. Choose your own color palette, type system, spacing scale, layout grid, and component styles. Dark mode, light mode, or something in between — your call.

**Quality bar:** A designer should look at this and think "this is well-crafted." Pay attention to the details: consistent spacing, intentional color choices, smooth transitions, typographic hierarchy, hover states that feel considered. Avoid default browser styles, avoid generic gray-on-white.

**Typography:** Choose a font pairing that feels premium. Load from Google Fonts CDN. Use `font-feature-settings: 'tnum'` for tabular numbers in data-heavy areas.

**Charts:** Use Chart.js. Choose a chart color palette that's harmonious with your overall theme — not just the Chart.js defaults. Customize tooltips, gridlines, and axis labels to match your design system.

**Responsive:** Must work well at 1920px, 1280px, 768px, and 480px viewports. Sidebar should collapse gracefully on smaller screens.

### Client-Side Routing

Hash-based routing in `public/index.html`. The URL hash determines which page is rendered.

| Route | Page | Description |
|-------|------|-------------|
| `#/overview` | Overview | Executive summary (default) |
| `#/trends` | Trends | Time-based deep dive with date range picker |
| `#/categories` | Categories | Category breakdown with drill-down |
| `#/cardholders` | Cardholders | Per-person profiles |
| `#/outliers` | Outliers | Triage workflow |

- `/` or `#/` or empty hash → redirect to `#/overview`
- Listen for `hashchange` event to handle navigation
- Each page is a function that clears the main content area and renders its own UI
- Sidebar nav items link to their hash routes and show active state based on current hash
- Browser back/forward must work correctly
- Page transitions should be smooth (CSS fade or slide)

### Required Components

You have creative freedom on HOW these look and are arranged, but these components MUST exist on EVERY page:

1. **Sidebar navigation** — with FUNCTIONAL nav items for: Overview, Trends, Categories, Cardholders, Outliers. These link to their hash routes. Also include decorative items: Cards, Transactions, Receipts, Settings, Help (these use `cursor: default`, no click handler). Include the Extend brand mark and a user profile area (initials "JB", role "Card Manager"). Show keyboard shortcut hints next to nav items (e.g., "G O" next to Overview).

2. **Header area** — dynamic page title (changes per page: "Overview", "Trends", "Categories", etc.), last refresh timestamp, active date range indicator (shows current filter if not "All"), and decorative elements (search icon, notification bell, user avatar). Decorative elements use `cursor: default`.

3. **Toast notifications** — for action feedback (triage changes, reminders, CSV export, data refresh). Non-blocking, auto-dismiss after 3 seconds, stack from bottom-right.

4. **Command palette** — `Cmd+K` / `Ctrl+K` overlay. Searches pages, transactions (by merchant/cardholder), and actions. Arrow key navigation, Enter to select, Escape to close.

5. **Keyboard shortcut help overlay** — triggered by `?` key. Shows all available shortcuts.

6. **Loading states** — skeleton loaders for charts and tables while data loads. Error states if fetch fails.

### Page-Specific Components

**Overview page:**
- 4 summary cards with sparklines and period comparison deltas (from `/api/summary` + `/api/comparison`)
- Spend over time chart with moving average (from `/api/trends`)
- Category breakdown chart (from `/api/categories`)
- Quick-view outlier table (latest 5 flagged, from `/api/transactions?status=flagged&limit=5`)
- Recent activity feed (last 10 transactions, from `/api/transactions?status=all&limit=10`)

**Trends page:**
- Date range picker: preset buttons (7d, 30d, 90d, All) + custom date inputs
- Period comparison toggle checkbox
- Spend over time chart (larger than overview version)
- Daily transaction count chart
- Average transaction size over time chart
- Cumulative spend chart (running total)
- Day-of-week heatmap

**Categories page:**
- Category bar chart (all categories)
- Category table: name, total spend, count, % of total, avg transaction, outlier count, sparkline
- Click row to drill down (show that category's transactions inline or as filtered view)

**Cardholders page:**
- Cardholder table: name, total spend, count, outlier count, top category, avg transaction
- Search and sort
- Click row to expand inline profile: spending timeline chart, top categories chart, outlier history, receipt reminder quick action

**Outliers page:**
- Status bucket tabs: Flagged | Acknowledged | Investigating | All
- Inline filter row: Type dropdown, Severity dropdown, Search (debounced 300ms), Export CSV, Refresh Data
- Transaction table with checkbox + 6 data columns (Date, Merchant, Category, Card, Card User, Amount)
- Column sorting, severity badges, pagination (25 per page)
- Detail modal on row click: full details, outlier context cards, triage actions, receipt reminder
- Floating action bar for bulk actions when rows selected
- `j`/`k` keyboard navigation for table rows, `Enter` to open detail

### Outlier Table Columns (EXACT ORDER — Outliers page)

| # | Header | Internal Field | Display Notes |
|---|--------|---------------|---------------|
| 0 | ☐ | (checkbox) | Select row for bulk actions |
| 1 | Date | `date` | Format: "Feb 4, 2026" |
| 2 | Merchant | `merchant` | With MCC group as secondary text |
| 3 | Category | `mcc_group` | As a subtle badge/pill |
| 4 | Card | `vcn_display_name` | With `vcn_last4` as secondary text |
| 5 | Card User | `cardholder` | Cardholder name |
| 6 | Amount | `amount_cents` | Right-aligned USD, status indicator (Cleared/Declined/Reversal) |

### Interactivity Rules

Every visible interactive element must either do something or not exist. Do NOT render non-functional elements that look clickable.

**Rule:** If it has `cursor: pointer` and a hover state, it MUST have a click handler that does something. Otherwise use `cursor: default` and no hover effect.

### Global State

The frontend maintains a small global state object:

```javascript
const appState = {
  dateRange: { from: null, to: null, preset: 'all' },  // null = no filter
  comparison: false,  // period comparison toggle
  currentPage: 'overview'
};
```

- `dateRange` persists across page navigation. Changed on the Trends page, affects all pages.
- `comparison` toggles period-over-period display. Changed on Trends page.
- When `dateRange` has values, all API calls append `from` and `to` query params.

## File Boundaries (CRITICAL)

| File | Responsibility | Must NOT contain |
|------|---------------|------------------|
| `fetch-data.py` | Extend API calls, pagination, JSON output | Outlier logic, UI code, Express routes |
| `server.js` | Load data, normalize, compute baselines, detect outliers, serve READ + WRITE API, serve static, manage triage.json | HTML/CSS |
| `public/index.html` | All UI: HTML structure, CSS styles, JS fetch/render logic | Node.js code, file system access, direct API calls to Extend |

**Allowed files:** `fetch-data.py`, `server.js`, `public/index.html`, `package.json`, `data/transactions.json`, `data/triage.json`.

**Note on Extend API calls in server.js:** The server makes direct HTTP calls to the Extend API in two places: (1) `/api/refresh` shells out to `fetch-data.py`, (2) `/api/actions/remind` calls the Extend receipt reminder endpoint via HTTP. Use the `node-fetch` package or Node's built-in `fetch` (Node 18+) — do NOT add axios or other HTTP libraries.

## Error Handling Pattern

- **fetch-data.py:** Print errors to stderr with `flush=True`. Save partial results if any pages succeeded. Exit with non-zero code on total failure.
- **server.js:** Return `{ "error": "message" }` with appropriate HTTP status. Never crash on bad data — log and skip malformed records.
- **index.html:** Show user-friendly error messages in the UI. Never show raw JSON errors. Retry failed fetches once before showing error state.
