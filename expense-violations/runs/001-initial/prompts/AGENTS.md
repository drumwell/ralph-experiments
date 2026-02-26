# Operational Learnings

Project-specific knowledge accumulated during development. Update this file when you discover gotchas or patterns that work.

## Extend API

- SDK package is `paywithextend`, import is `from extend import ExtendClient`
- Auth uses `BasicAuth(api_key, api_secret)` from `extend.auth`
- Transactions endpoint is paginated — must loop until empty batch
- Amount fields are likely in cents (verify from actual response)

## Environment

- Python venv is at `.venv/` — always use `.venv/bin/python3`
- Environment variables required: `EXTEND_API_KEY`, `EXTEND_API_SECRET`
- Express server runs on port 3000

## Known Issues

- API returns duplicate data on pages > 3 (same transactions keep repeating)
- **FIX REQUIRED:** Deduplicate by transaction ID — stop fetching when you see IDs you've already seen, OR dedupe in server.js on load
- Current data has 8,254 records but only 282 unique transactions — this inflates all stats by ~30x

## Critical Rule

**When you identify a bug, FIX IT — don't just document it and move on.** If something is wrong, the task isn't done.

## Patterns That Work

- Use `flush=True` in print statements for real-time output
- Save data even on API error to avoid losing fetched data

## Extend UI Design Reference

**Theme:** Light (NOT dark!)

**Color Palette:**
- Background: `#ffffff` (white)
- Sidebar: `#f8fafc` (light gray)
- Cards/containers: `#ffffff` with subtle shadow
- Primary accent: `#10b981` (teal/green)
- Text primary: `#1e293b` (dark slate)
- Text secondary: `#64748b` (muted gray)
- Border: `#e2e8f0` (light border)
- Status Active: `#10b981` (green)
- Status Pending: `#6b7280` (gray)
- Status Declined: `#ef4444` (red)
- Status Cancelled: `#f97316` (orange)
- Status Reversal: `#ef4444` (red)
- Amount negative: `#ef4444` (red)

**Typography:**
- Font: system-ui, -apple-system, sans-serif
- Headers: 600 weight
- Body: 400 weight

**Components:**
- Sidebar: ~240px wide, icons + text, active item has teal left border
- Tables: subtle row borders, hover states, right-aligned amounts
- Badges: rounded pills, ~6px padding, small text
- Buttons: rounded corners, teal for primary actions

## Transaction Schema

Key fields from Extend API response:
- `id` - transaction ID
- `merchantName` - merchant name
- `authedAt` - authorization timestamp
- `authBillingAmountCents` - amount in cents (use this for amount)
- `virtualCardId` - virtual card ID
- `vcnDisplayName` - **USE THIS** for Card column (e.g., "AI Tool VCN (Nov 2025 to Dec 20...)")
- `vcnLast4` - last 4 digits of card (show below card name)
- `recipientName` - cardholder name
- `mcc` - merchant category code
- `hasAttachments` / `attachmentsCount` - for receipt detection
- `status` - CLEARED, DECLINED, PENDING, NO_MATCH

## Table Columns (EXACT ORDER)

| # | Header | API Field | Display Notes |
|---|--------|-----------|---------------|
| 1 | Date | `authedAt` | Format: "2/4/2026" |
| 2 | Merchant | `merchantName` | With merchant category icon, show "RETAIL" below |
| 3 | Card | `vcnDisplayName` | Show card name, with `vcnLast4` below in gray |
| 4 | Card User | `recipientName` | User's name |
| 5 | Team | — | We don't have this, show "-" or omit |
| 6 | Receipts | `hasAttachments` | Flag/document icon, not checkmark |
| 7 | Amount | `authBillingAmountCents` | Right-aligned, status badge below |

## Sidebar Navigation (EXACT STRUCTURE)

```
┌─────────────────────────┐
│ 🟢 Extend Enterprise... │  ← Logo + org name
├─────────────────────────┤
│ 🏠 Home                 │
│ 📊 Activity             │
│ ⚡ AI Agent             │
│ 👤 My Wallet         ▼  │  ← Collapsible
│    └─ Cards             │
│    └─ Budgets           │
│    └─ Transactions      │
│    └─ Reimbursements    │
│ 👥 Manager Review    ▼  │  ← Collapsible
│ 💳 Cards             ▼  │
│ 💰 Budgets              │
│ 💵 Card Transactions ◀  │  ← Active (teal)
│ 👥 People               │
│ 📈 Insights             │
├─────────────────────────┤
│ ⚙️ Settings             │
│ ❓ Help & Support       │
│ 🟢 extend               │  ← Logo at bottom
└─────────────────────────┘
```

## Header Layout (EXACT)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Extend Logo]  Card Transactions          [Create New +] 🔍 [JB ▼]  │
│                                                          Card Manager│
└──────────────────────────────────────────────────────────────────────┘
```

- Left: Extend logo (teal icon + "Extend Enterprise...")
- Center-left: Page title "Card Transactions" (large, bold)
- Right: "Create New +" button (teal, rounded), search icon, user avatar with name

## Search/Filter Bar (EXACT)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Transaction Date ⓘ     🔍 Enter an amount, merchant name...   🔽 Receipt Tools ▼ ⬇ │
│ Jan 5, 2026 - Feb 4, 2026 ▼                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

- Date picker on left with calendar icon
- Search input in center
- Filter icon, "Receipt Tools" dropdown, download icon on right

## Amount Cell (EXACT)

```
For positive/cleared:          For declined:           For reversal:
┌────────────┐                ┌────────────┐          ┌────────────┐
│     $21.78 │ (black)        │     $21.78 │ (red)    │    -$1.98  │ (red)
│   Pending  │ (gray pill)    │   Declined │ (red)    │   Reversal │ (red pill)
└────────────┘                └────────────┘          └────────────┘
```

## Receipt Column Icon

Use a FLAG/DOCUMENT icon (not checkmark):
- Has receipt: Gray flag icon
- Missing receipt: Empty or highlighted flag
- Extend uses: `<svg>` flag/bookmark style icon
