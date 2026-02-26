#!/bin/bash
# =============================================================================
# tests.sh — Growing test suite for the Spend Intelligence Platform
#
# Ralph maintains this file. Add new test cases as features are built.
# The loop runs this after every builder iteration and pipes output to
# specs/TEST_RESULTS.md for the next iteration to read.
#
# Exit code: 0 if all tests pass, 1 if any fail.
# =============================================================================

set -euo pipefail

PASS=0
FAIL=0
ERRORS=""

# ── Helpers ──────────────────────────────────────────────────────────────────

assert_ok() {
    local description="$1"
    local command="$2"
    if eval "$command" >/dev/null 2>&1; then
        echo "  PASS: $description"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $description"
        ERRORS="${ERRORS}\n  - ${description}"
        FAIL=$((FAIL + 1))
    fi
}

assert_json() {
    local description="$1"
    local url="$2"
    local response
    response=$(curl -sf "$url" 2>/dev/null || echo "CURL_FAILED")
    if [[ "$response" == "CURL_FAILED" ]]; then
        echo "  FAIL: $description (curl failed)"
        ERRORS="${ERRORS}\n  - ${description} (curl failed)"
        FAIL=$((FAIL + 1))
        return
    fi
    if echo "$response" | python3 -m json.tool >/dev/null 2>&1; then
        echo "  PASS: $description"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $description (invalid JSON)"
        ERRORS="${ERRORS}\n  - ${description} (invalid JSON)"
        FAIL=$((FAIL + 1))
    fi
}

assert_python() {
    local description="$1"
    local code="$2"
    if python3 -c "$code" >/dev/null 2>&1; then
        echo "  PASS: $description"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $description"
        ERRORS="${ERRORS}\n  - ${description}"
        FAIL=$((FAIL + 1))
    fi
}

# ── Setup: start server ─────────────────────────────────────────────────────

echo "=== Test Suite: $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""

# Only start server if server.js exists
if [[ ! -f server.js ]]; then
    echo "  SKIP: server.js does not exist yet. Skipping server tests."
    echo ""
    echo "=== Results: 0 passed, 0 failed (server not built yet) ==="
    exit 0
fi

# Install deps if needed
[[ -d node_modules ]] || npm install --silent 2>/dev/null

pkill -f "node server.js" 2>/dev/null || true
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2
node server.js &
SERVER_PID=$!
sleep 2

# Verify server started
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "  FAIL: Server failed to start"
    echo ""
    echo "=== Results: 0 passed, 1 failed ==="
    echo "FAILURES:"
    echo "  - Server failed to start"
    exit 1
fi

# ── Data integrity tests ────────────────────────────────────────────────────

echo "--- Data Integrity ---"

if [[ -f data/transactions.json ]]; then
    assert_python "No duplicate transaction IDs" "
import json
d = json.load(open('data/transactions.json'))
ids = [t['id'] for t in d]
assert len(ids) == len(set(ids)), f'Found {len(ids) - len(set(ids))} duplicates'
assert len(d) > 0, 'Empty transactions file'
"
    assert_python "Transactions have required fields" "
import json
d = json.load(open('data/transactions.json'))
required = ['id']
for t in d[:5]:
    for f in required:
        assert f in t, f'Missing field: {f}'
"
else
    echo "  SKIP: data/transactions.json does not exist yet"
fi

# ── Core API endpoint tests ─────────────────────────────────────────────────

echo ""
echo "--- Core API Endpoints ---"

assert_json "GET /api/summary returns valid JSON" "http://localhost:3000/api/summary"
assert_json "GET /api/transactions returns valid JSON" "http://localhost:3000/api/transactions?status=flagged&limit=5"
assert_json "GET /api/trends returns valid JSON" "http://localhost:3000/api/trends"
assert_json "GET /api/categories returns valid JSON" "http://localhost:3000/api/categories"
assert_json "GET /api/top-spenders returns valid JSON" "http://localhost:3000/api/top-spenders"
assert_json "GET /api/distribution returns valid JSON" "http://localhost:3000/api/distribution"
assert_json "GET /api/day-of-week returns valid JSON" "http://localhost:3000/api/day-of-week"

# Summary shape check
assert_python "Summary has required fields" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/summary').read())
for f in ['total_spend_cents', 'transaction_count', 'outlier_count', 'avg_transaction_cents', 'by_triage_status']:
    assert f in d, f'Missing field: {f}'
"

# Transactions shape check
assert_python "Transactions response has counts" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=5').read())
assert 'counts' in d, 'Missing counts'
assert 'transactions' in d, 'Missing transactions'
assert 'total' in d, 'Missing total'
"

# Sort order check
assert_python "Transactions sorted by date descending" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=10').read())
dates = [t['date'] for t in d['transactions']]
assert dates == sorted(dates, reverse=True), f'Not sorted desc: {dates[:3]}'
"

# ── Trends endpoint tests ───────────────────────────────────────────────────

echo ""
echo "--- Trends ---"

assert_python "/api/trends returns array with moving average" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/trends').read())
assert isinstance(d, list), 'trends must return an array'
assert len(d) > 0, 'trends array is empty'
for entry in d:
    assert 'date' in entry, 'Missing date field'
    assert 'amount_cents' in entry, 'Missing amount_cents field'
    assert 'moving_avg_cents' in entry, 'Missing moving_avg_cents field'
"

# ── Categories endpoint tests ────────────────────────────────────────────────

echo ""
echo "--- Categories ---"

assert_python "/api/categories returns array with pct_of_total" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/categories').read())
assert isinstance(d, list), 'categories must return an array'
assert len(d) > 0, 'categories array is empty'
assert len(d) <= 10, f'categories should be top 10, got {len(d)}'
for entry in d:
    assert 'mcc_group' in entry, 'Missing mcc_group field'
    assert 'amount_cents' in entry, 'Missing amount_cents field'
    assert 'pct_of_total' in entry, 'Missing pct_of_total field'
"

# ── Top spenders endpoint tests ──────────────────────────────────────────────

echo ""
echo "--- Top Spenders ---"

assert_python "/api/top-spenders returns array with cardholder and spend fields" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/top-spenders').read())
assert isinstance(d, list), 'top-spenders must return an array'
assert len(d) > 0, 'top-spenders array is empty'
assert len(d) <= 5, f'top-spenders should be top 5, got {len(d)}'
for entry in d:
    assert 'cardholder' in entry, 'Missing cardholder field'
    assert 'total_spend_cents' in entry, 'Missing total_spend_cents field'
    assert 'transaction_count' in entry, 'Missing transaction_count field'
"

# ── All Cardholders endpoint tests ───────────────────────────────────────────

echo ""
echo "--- All Cardholders ---"

assert_python "/api/cardholders returns all cardholders with avg_transaction_cents" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/cardholders').read())
assert isinstance(d, list), 'cardholders must return an array'
assert len(d) > 0, 'cardholders array is empty'
for entry in d:
    assert 'cardholder' in entry, 'Missing cardholder field'
    assert 'total_spend_cents' in entry, 'Missing total_spend_cents field'
    assert 'transaction_count' in entry, 'Missing transaction_count field'
    assert 'avg_transaction_cents' in entry, 'Missing avg_transaction_cents field'
    assert 'top_category' in entry, 'Missing top_category field'
    assert 'outlier_count' in entry, 'Missing outlier_count field'
"

# ── Distribution endpoint tests ──────────────────────────────────────────────

echo ""
echo "--- Distribution ---"

assert_python "/api/distribution returns 6 buckets" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/distribution').read())
assert isinstance(d, list), 'distribution must return an array'
assert len(d) == 6, f'distribution should have 6 buckets, got {len(d)}'
for entry in d:
    assert 'bucket' in entry, 'Missing bucket field'
    assert 'count' in entry, 'Missing count field'
    assert 'total_cents' in entry, 'Missing total_cents field'
"

# ── Day-of-week endpoint tests ───────────────────────────────────────────────

echo ""
echo "--- Day of Week ---"

assert_python "/api/day-of-week returns 7 days" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/day-of-week').read())
assert isinstance(d, list), 'day-of-week must return an array'
assert len(d) == 7, f'day-of-week should have 7 entries, got {len(d)}'
for entry in d:
    assert 'day' in entry, 'Missing day field'
    assert 'day_name' in entry, 'Missing day_name field'
    assert 'avg_spend_cents' in entry, 'Missing avg_spend_cents field'
"

# ── New API endpoints (Milestone 3-4) ────────────────────────────────────────

echo ""
echo "--- Date Range & Comparison API ---"

assert_python "/api/summary has sparklines field" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/summary').read())
assert 'sparklines' in d, 'Missing sparklines in summary'
assert 'spend' in d['sparklines'], 'Missing sparklines.spend'
"

assert_json "GET /api/comparison returns valid JSON" "http://localhost:3000/api/comparison"

assert_python "/api/comparison has current, previous, deltas" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/comparison').read())
assert 'current' in d, 'Missing current'
assert 'previous' in d, 'Missing previous'
assert 'deltas' in d, 'Missing deltas'
assert 'total_spend_pct' in d['deltas'], 'Missing total_spend_pct in deltas'
"

assert_python "/api/summary accepts from/to date params" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/summary?from=2026-01-01&to=2026-01-31').read())
assert 'total_spend_cents' in d, 'Missing total_spend_cents with date params'
"

assert_python "/api/trends has cumulative_cents" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/trends').read())
assert len(d) > 0, 'trends empty'
assert 'cumulative_cents' in d[0], 'Missing cumulative_cents in trends'
"

echo ""
echo "--- Cardholder API ---"

assert_python "/api/cardholder/:name returns full profile" "
import urllib.request, json
spenders = json.loads(urllib.request.urlopen('http://localhost:3000/api/top-spenders').read())
name = spenders[0]['cardholder']
encoded = urllib.parse.quote(name)
d = json.loads(urllib.request.urlopen(f'http://localhost:3000/api/cardholder/{encoded}').read())
assert 'cardholder' in d, 'Missing cardholder'
assert 'spending_timeline' in d, 'Missing spending_timeline'
assert 'top_categories' in d, 'Missing top_categories'
assert 'outlier_transactions' in d, 'Missing outlier_transactions'
assert 'missing_receipt_transactions' in d, 'Missing missing_receipt_transactions'
"

echo ""
echo "--- Enhanced Categories ---"

assert_python "/api/categories?all=true returns all with sparkline, avg_cents, outlier_count" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/categories?all=true').read())
assert len(d) >= 3, f'Expected multiple categories with all=true, got {len(d)}'
assert 'sparkline' in d[0], 'Missing sparkline'
assert 'avg_cents' in d[0], 'Missing avg_cents'
assert 'outlier_count' in d[0], 'Missing outlier_count'
"

# ── Static serving test ──────────────────────────────────────────────────────

echo ""
echo "--- Static Serving ---"

# Debug: test if server is responding and what it returns
if curl -sf http://localhost:3000/ >/tmp/test_root.html 2>&1; then
    if grep -q '<html' /tmp/test_root.html 2>/dev/null; then
        echo "  PASS: GET / returns HTML"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: GET / returns HTML (found content but no <html tag)"
        echo "    First 100 chars: $(head -c 100 /tmp/test_root.html)"
        ERRORS="${ERRORS}\n  - GET / returns HTML"
        FAIL=$((FAIL + 1))
    fi
else
    echo "  FAIL: GET / returns HTML (curl failed)"
    ERRORS="${ERRORS}\n  - GET / returns HTML"
    FAIL=$((FAIL + 1))
fi

# ── Client-side routing tests ────────────────────────────────────────────────

echo ""
echo "--- Client-Side Routing ---"

assert_python "HTML has hash routes for all 5 pages" "
import urllib.request
html = urllib.request.urlopen('http://localhost:3000/').read().decode()
for route in ['#/overview', '#/trends', '#/categories', '#/cardholders', '#/outliers']:
    assert route in html, f'Missing route: {route}'
assert 'hashchange' in html, 'Missing hashchange listener'
"

# ── Outlier detection tests ──────────────────────────────────────────────────

echo ""
echo "--- Outlier Detection ---"

assert_python "At least one MISSING_RECEIPT_HIGH outlier exists" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=500').read())
rules = [o['rule_id'] for t in d['transactions'] for o in t.get('outliers', [])]
assert 'MISSING_RECEIPT_HIGH' in rules, 'No MISSING_RECEIPT_HIGH outliers found'
"

assert_python "At least one AMOUNT_OUTLIER or VELOCITY_SPIKE outlier exists" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=500').read())
rules = set(o['rule_id'] for t in d['transactions'] for o in t.get('outliers', []))
assert 'AMOUNT_OUTLIER' in rules or 'VELOCITY_SPIKE' in rules, f'No statistical outliers found. Rules seen: {rules}'
"

assert_python "Outlier objects have required fields (rule_id, severity, description, context)" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=5').read())
for t in d['transactions']:
    for o in t.get('outliers', []):
        assert 'rule_id' in o, 'Missing rule_id'
        assert 'severity' in o, 'Missing severity'
        assert 'description' in o, 'Missing description'
        assert 'context' in o, 'Missing context'
"

# ── Triage state persistence tests ───────────────────────────────────────────

echo ""
echo "--- Triage State Persistence ---"

assert_python "POST triage → status reflected in GET transactions" "
import urllib.request, json, urllib.error

# Get first flagged transaction
url = 'http://localhost:3000/api/transactions?status=flagged&limit=1'
d = json.loads(urllib.request.urlopen(url).read())
assert len(d['transactions']) > 0, 'No flagged transactions to test with'
txn_id = d['transactions'][0]['id']

# Set to acknowledged
payload = json.dumps({'transaction_id': txn_id, 'triage_status': 'acknowledged'}).encode()
req = urllib.request.Request('http://localhost:3000/api/actions/triage',
    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
res = urllib.request.urlopen(req)
assert res.status == 200, f'POST failed: {res.status}'

# Check it appears in acknowledged bucket (use high limit to ensure we get all)
url2 = 'http://localhost:3000/api/transactions?status=acknowledged&limit=100'
d2 = json.loads(urllib.request.urlopen(url2).read())
ids = [t['id'] for t in d2['transactions']]
assert txn_id in ids, f'Transaction {txn_id} not found in acknowledged bucket'

# Reset back to flagged
payload2 = json.dumps({'transaction_id': txn_id, 'triage_status': 'flagged'}).encode()
req2 = urllib.request.Request('http://localhost:3000/api/actions/triage',
    data=payload2, headers={'Content-Type': 'application/json'}, method='POST')
urllib.request.urlopen(req2)
"

assert_python "POST triage to investigating reflected in counts" "
import urllib.request, json

# Get first flagged transaction
url = 'http://localhost:3000/api/transactions?status=flagged&limit=1'
d = json.loads(urllib.request.urlopen(url).read())
assert len(d['transactions']) > 0, 'No flagged transactions'
txn_id = d['transactions'][0]['id']

# Get initial investigating count
d_before = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=investigating&limit=1').read())
count_before = d_before['total']

# Set to investigating
payload = json.dumps({'transaction_id': txn_id, 'triage_status': 'investigating'}).encode()
req = urllib.request.Request('http://localhost:3000/api/actions/triage',
    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
urllib.request.urlopen(req)

# Check count increased
d_after = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=investigating&limit=1').read())
count_after = d_after['total']
assert count_after == count_before + 1, f'Expected {count_before+1} investigating, got {count_after}'

# Reset back to flagged
payload2 = json.dumps({'transaction_id': txn_id, 'triage_status': 'flagged'}).encode()
req2 = urllib.request.Request('http://localhost:3000/api/actions/triage',
    data=payload2, headers={'Content-Type': 'application/json'}, method='POST')
urllib.request.urlopen(req2)
"

# ── Command Palette + Keyboard Shortcuts tests ───────────────────────────────

echo ""
echo "--- Command Palette & Keyboard Shortcuts ---"

assert_python "HTML has command palette component" "
import urllib.request
html = urllib.request.urlopen('http://localhost:3000/').read().decode()
has_cmdk = 'Cmd+K' in html or 'cmd+k' in html.lower() or 'ctrl+k' in html.lower() or 'Meta+k' in html
has_palette = 'command-palette' in html or 'commandPalette' in html or 'cmd-palette' in html
assert has_cmdk or has_palette, 'Missing command palette trigger or component'
"

assert_python "HTML has keyboard shortcut references" "
import urllib.request
html = urllib.request.urlopen('http://localhost:3000/').read().decode()
assert 'shortcut' in html.lower() or 'keydown' in html or 'keypress' in html, 'Missing keyboard shortcut handling'
"

# ── Responsive Design tests ──────────────────────────────────────────────────

echo ""
echo "--- Responsive Design ---"

assert_python "HTML has responsive media queries" "
import urllib.request
html = urllib.request.urlopen('http://localhost:3000/').read().decode()
has_tablet = '@media' in html and ('1023px' in html or '1024px' in html or '768px' in html)
has_mobile = '@media' in html and ('479px' in html or '480px' in html)
assert has_tablet, 'Missing tablet breakpoint media query'
assert has_mobile, 'Missing mobile breakpoint media query'
"

assert_python "HTML has sidebar navigation with functional nav items" "
import urllib.request
html = urllib.request.urlopen('http://localhost:3000/').read().decode()
assert 'sidebar' in html.lower(), 'Missing sidebar element'
# Check nav items link to hash routes
for route in ['#/overview', '#/trends', '#/categories', '#/cardholders', '#/outliers']:
    assert route in html, f'Sidebar missing link to {route}'
"

assert_python "Table wrapper has overflow-x auto for horizontal scroll" "
import urllib.request
html = urllib.request.urlopen('http://localhost:3000/').read().decode()
assert 'overflow-x' in html or 'overflow: auto' in html, 'Table wrapper missing overflow-x handling'
"

# ── Teardown ─────────────────────────────────────────────────────────────────

pkill -f "node server.js" 2>/dev/null || true

# ── Results ──────────────────────────────────────────────────────────────────

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="

if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "FAILURES:"
    echo -e "$ERRORS"
    exit 1
else
    echo "ALL TESTS PASSED"
    exit 0
fi
