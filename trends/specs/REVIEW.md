# Review: 2026-02-24

Reviewed at: milestone 8 (Final QA), iteration 4

## Blockers (must fix before next milestone)

None.

## Warnings (should fix soon)

- [WARNING] **Toast notifications have no manual close button.** SPEC says "Auto-dismiss after 3 seconds, with manual close button." The `toast()` function only auto-dismisses — no ✕ button on the toast element. Reproducible: trigger any triage action and observe the toast has no close affordance.

- [WARNING] **Sidebar hides at 480px with no navigation fallback.** SPEC features list (#30) says "hides at 480px with hamburger." At ≤480px the sidebar is `display:none` and there is no hamburger toggle, leaving users with no way to navigate between pages. Visible via browser resize to ≤480px.

- [WARNING] **Comparison toggle has no effect with "All" date preset.** `renderTrends()` condition: `if (appState.comparison && appState.dateRange.from && appState.dateRange.to)` — when preset is "All" (`from`/`to` are null), checking the toggle is a no-op. The SPEC says comparison works unconditionally; ARCHITECTURE.md says "If no date range, compare the most recent half of the data to the first half." The `/api/comparison` endpoint implements this, but the Trends page never calls it for dual-series charts unless an explicit range is set. STATUS.md marks this "by design" — flagging for final QA since the spec expectation is unmet.

- [WARNING] **Bulk `remind` action doesn't guard against missing API credentials.** `POST /api/actions/bulk` with `action:"remind"` reads `EXTEND_API_KEY`/`EXTEND_API_SECRET` but doesn't check for undefined, unlike `/api/actions/remind` (which returns 500 with a clear message). With no credentials set, bulk remind will fail per-item with a confusing `TypeError` or an opaque `undefined:undefined` Basic Auth header.

  ```bash
  # Unset creds + bulk remind → status:"partial" with per-item error, not a clear 500
  curl -s -X POST http://localhost:3000/api/actions/bulk \
    -H "Content-Type: application/json" \
    -d '{"action":"remind","transaction_ids":["<valid-missing-receipt-id>"]}'
  ```

## Nits (low priority)

- [NIT] `toggleCatDetail` onclick uses `escHtml(c.mcc_group)` in a JS string context instead of `escAttr`. No practical impact since mcc_group values are uppercase ASCII (RETAIL, WHOLESALE, etc.), but inconsistent with the existing `escAttr` utility used elsewhere.

## Passed

- All 10 READ endpoints exist and return correct shapes: `/api/summary`, `/api/comparison`, `/api/transactions`, `/api/trends`, `/api/categories?all=true`, `/api/top-spenders`, `/api/distribution`, `/api/day-of-week`, `/api/cardholder/:name`, `/api/cardholders`
- `/api/summary` includes both `by_triage_status` and `sparklines` ✓
- `/api/transactions` returns `counts` in every response ✓
- `/api/comparison` returns `current`, `previous`, `deltas` with all four delta keys ✓
- `/api/cardholder/:name` returns full profile: `spending_timeline`, `top_categories`, `outlier_transactions`, `missing_receipt_transactions` ✓
- `/api/trends` includes `cumulative_cents` on every row ✓
- `/api/categories?all=true` returns all 8 categories with `sparkline`, `avg_cents`, `outlier_count` ✓
- All query params work on `/api/transactions`: `status`, `rule`, `severity`, `search`, `sort`, `order`, `category`, `from`/`to` ✓
- Date range filtering verified: `summary`, `transactions`, `distribution`, `top-spenders`, `trends` all filter by `from`/`to` ✓
- Error responses use `{ "error": "message" }` format with correct HTTP codes ✓
- `/api/violation-trends` and `/api/top-offenders` correctly return 404 ✓
- No violation terminology in UI or server code ✓
- No duplicate transaction IDs (293 unique) ✓
- Outlier detection is deterministic (same results on repeated calls) ✓
- AMOUNT_OUTLIER correctly skips cardholders with < 5 transactions (Jia Lin: 1 txn, Michelle Kuo: 2 txns, Stephanie Coste: 1 txn — none get AMOUNT_OUTLIER) ✓
- VELOCITY_SPIKE correctly skips cardholders with < 3 active days ✓
- MISSING_RECEIPT_HIGH correctly requires `receipt_missing === true` AND `amount_cents > 5000` ✓
- NEW_MERCHANT threshold is `> 10000` cents (strictly > $100) ✓
- CATEGORY_SPIKE threshold is `> 50%` of category total ✓
- WEEKEND_LARGE requires weekend day AND `> cardholder median` ✓
- All outlier objects include `context` string ✓
- Triage state persists to `data/triage.json` ✓
- Triage transitions: flagged → acknowledged → investigating → flagged (all tested) ✓
- `/api/refresh` does not clear triage state ✓
- Nonexistent transaction ID returns 404, not a crash ✓
- Bulk triage works: returns `{ status, results, failed }` ✓
- `fetch-data.py` overwrites (not appends) `data/transactions.json` ✓
- Hash routing: all 5 routes work; unknown hash falls back to overview; back/forward handled by hashchange ✓
- Sidebar: 5 functional nav items with active state; decorative items have `cursor: default` and no hover ✓
- Command palette: Cmd+K opens, search filters, arrow keys navigate, Enter selects, Escape closes ✓
- Keyboard shortcuts: `g o/t/c/h/l`, `j/k`, `Enter`, `Escape`, `?` all wired correctly ✓
- Shortcut help overlay shows on `?` ✓
- Date range picker: presets (7d/30d/90d/All) and custom inputs work; range persists across all pages ✓
- Active date range indicator in header updates correctly ✓
- Period comparison toggle fetches previous period and renders dual-series when explicit range is set ✓
- `escAttr` escape order is correct (backslash before apostrophe, fixed in iteration 6) ✓
- Category drill-down (click row → inline transactions) works ✓
- Cardholder inline profile (click row → stats + spending timeline + categories + outliers + remind action) works ✓
- Cardholder table has all 6 required columns: Name, Total Spend, Count, Outliers, Top Category, Avg Transaction ✓
- Outlier detail modal shows full transaction details, outlier context cards, triage actions, receipt reminder button ✓
- Triage actions in modal persist and reload the table ✓
- Bulk actions (Acknowledge, Investigate, Send Reminders) work with floating action bar ✓
- Export CSV generates and downloads current filtered view ✓
- Refresh Data button calls `/api/refresh` and re-renders ✓
- No TODO/FIXME/placeholder logic in server.js or index.html ✓
- No 500 errors on any endpoint ✓
- Responsive CSS: sidebar collapses to icon-only at 1024px, hides at 480px ✓
- Loading skeletons present for charts and tables ✓
- Error states with retry buttons on all pages ✓
- Toast notifications called for all actions (triage, remind, refresh, export) ✓
- Smooth page transitions via `.page-fade` CSS animation ✓
- Chart.js loaded via CDN, custom palette consistent with dark theme ✓
- No dead UI: decorative elements use `cursor: default`, no orphaned `cursor: pointer` elements ✓
