# Extend Expense Policy Dashboard

Build a Node.js dashboard that analyzes real Extend transaction data for policy violations.

## Your Task

**Quick check (don't over-do it):**
- Glance at `IMPLEMENTATION_PLAN.md` — what's the next uncompleted task?
- Only run the app if you suspect something is broken
- Don't re-read every file — trust previous iterations

**If something looks broken:** fix it first, then continue.

**Then execute (KEEP IT SMALL):**
1. Read `IMPLEMENTATION_PLAN.md` to find the FIRST uncompleted task
2. Read `AGENTS.md` for project-specific gotchas
3. Do ONLY that one task — you have ~15 tool calls, use them wisely
4. Verify it works (run the code, check visually!)
5. Mark it complete in `IMPLEMENTATION_PLAN.md`
6. STOP — you're done for this iteration, the loop will restart you

**You will be cut off at 15 tool calls.** Plan accordingly. Do ONE thing well, not many things partially.

**When ALL tasks are done and verified:** output `<promise>COMPLETE</promise>`

## Architecture

- **Data fetch:** Python script using `paywithextend` SDK → writes to `data/transactions.json`
- **Server:** Express on port 3000, serves API + static HTML
- **Frontend:** Single `public/index.html` with Chart.js (CDN), no build step

## File Structure

```
fetch-data.py           # Fetches from Extend API
server.js               # Express server + violation logic
public/index.html       # Dashboard UI
data/transactions.json  # Cached transaction data
```

## Step 1: Fetch Data

Use the Python venv at `.venv/`. Install the SDK if needed:

```bash
.venv/bin/pip install paywithextend
```

The SDK is async. Example:

```python
import asyncio, os, json
from extend import ExtendClient
from extend.auth import BasicAuth

async def main():
    client = ExtendClient(auth=BasicAuth(os.environ["EXTEND_API_KEY"], os.environ["EXTEND_API_SECRET"]))

    # API is paginated - fetch all pages
    all_transactions = []
    page = 0
    while True:
        result = await client.transactions.get_transactions(page=page, per_page=100)
        batch = result.get("report", {}).get("transactions", [])
        if not batch:
            break
        all_transactions.extend(batch)
        print(f"Page {page}: {len(batch)} transactions")
        page += 1

    os.makedirs("data", exist_ok=True)
    with open("data/transactions.json", "w") as f:
        json.dump(all_transactions, f, indent=2, default=str)
    print(f"Total: {len(all_transactions)} transactions")

asyncio.run(main())
```

**Important:** The API paginates results. Loop until you get an empty batch.

**If the API fails, stop and print the error. Do NOT generate mock data.**

## Step 2: Normalize Data

After fetching, log the first transaction's keys to see the actual schema:

```javascript
const raw = JSON.parse(fs.readFileSync('./data/transactions.json', 'utf-8'));
console.log('Keys:', Object.keys(raw[0] || {}));
```

Map to this shape (adapt field names to what you actually see):

```javascript
{ id, merchant, amount_cents, date, virtual_card_id, cardholder, mcc, receipt_missing }
```

Likely Extend fields: `id`, `merchantName`, `authedAmount` (cents), `authorizationDate`, `virtualCardId`, `recipientName`, `mcc`, `receiptAttachments` (array).

## Policy Violations

Flag transactions matching ANY rule:

| Rule | ID | Condition |
|------|----|-----------|
| Duplicate merchant | `DUPLICATE_MERCHANT` | Same merchant + cardholder within 24 hours |
| Round amount | `ROUND_AMOUNT` | amount_cents % 100 === 0 AND amount > $100 |
| Weekend spend | `WEEKEND_SPEND` | Saturday or Sunday |
| Missing receipt | `MISSING_RECEIPT` | No receipt attachments AND amount > $25 |
| High velocity | `HIGH_VELOCITY` | >5 txns on same virtual card in one calendar day |

## API Routes

```
GET /                → public/index.html
GET /api/summary     → { total_spend_cents, transaction_count, violation_count, compliance_rate }
GET /api/violations  → [ { ...transaction, violations: ["RULE_ID", ...] }, ... ]
GET /api/trends      → daily spend totals (last 30 days)
```

## Dashboard UI

**IMPORTANT:** Match Extend's actual UI — see `AGENTS.md` for exact colors and design specs.

**Key points:**
- **Light theme** (white background, NOT dark)
- Teal/green accent (`#10b981`)
- Left sidebar navigation
- Clean table with status badges
- Receipt icons
- Amounts right-aligned, negatives in red

See `IMPLEMENTATION_PLAN.md` Phase 6 for detailed UI tasks.

## Verification (REQUIRED)

After ANY code change:

```bash
# 1. Fetch data if missing
[ ! -f data/transactions.json ] && .venv/bin/python3 fetch-data.py

# 2. Install deps
[ ! -d node_modules ] && npm install

# 3. Kill old server, start new
pkill -f "node server.js" 2>/dev/null; sleep 1
node server.js &
sleep 2

# 4. Test endpoints
curl -sf http://localhost:3000/ | head -5
curl -sf http://localhost:3000/api/summary
curl -sf http://localhost:3000/api/violations | head -20
```

**If ANY endpoint fails, fix and re-run verification.** Leave the server running for visual checks.

### Visual Verification (for UI tasks)

You have a **Playwright MCP server** available. Use it for UI tasks:

1. Make sure the Express server is running on port 3000
2. Use the Playwright tools to navigate to `http://localhost:3000`
3. Take a screenshot and examine it — you can see images
4. Compare what you see against the spec in `AGENTS.md`
5. If something looks wrong, fix it and screenshot again

**When to use visual verification:** Any task in Phase 6 or 7, or any task that touches `public/index.html`.

**When to skip it:** Backend-only changes (API endpoints, data fetching).

After verification, kill the server:
```bash
pkill -f "node server.js"
```

## Done When

All tasks in `IMPLEMENTATION_PLAN.md` are checked off AND verified:

- [ ] Real Extend data in `data/transactions.json`
- [ ] All endpoints return valid JSON
- [ ] Dashboard renders with charts
- [ ] Violations table shows flagged transactions

When complete, output: `<promise>COMPLETE</promise>`
