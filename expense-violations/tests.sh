#!/bin/bash
# =============================================================================
# tests.sh — Growing test suite for the Expense Compliance Dashboard
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
sleep 1
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

# ── API endpoint tests ──────────────────────────────────────────────────────

echo ""
echo "--- API Endpoints ---"

assert_json "GET /api/summary returns valid JSON" "http://localhost:3000/api/summary"
assert_json "GET /api/transactions returns valid JSON" "http://localhost:3000/api/transactions?status=flagged&limit=5"
assert_json "GET /api/trends returns valid JSON" "http://localhost:3000/api/trends"
assert_json "GET /api/top-offenders returns valid JSON" "http://localhost:3000/api/top-offenders"

# Summary shape check
assert_python "Summary has required fields" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/summary').read())
for f in ['total_spend_cents', 'transaction_count', 'violation_count', 'compliance_rate', 'by_review_status']:
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

# ── Static serving test ──────────────────────────────────────────────────────

echo ""
echo "--- Static Serving ---"

assert_ok "GET / returns HTML" "curl -sf http://localhost:3000/ | grep -q '<html'"

# ── Violation detection tests ─────────────────────────────────────────────────

echo ""
echo "--- Violation Detection ---"

assert_python "At least one MISSING_RECEIPT violation exists" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=500').read())
rules = [v['rule_id'] for t in d['transactions'] for v in t.get('violations', [])]
assert 'MISSING_RECEIPT' in rules, 'No MISSING_RECEIPT violations found'
"

assert_python "At least one WEEKEND_SPEND violation exists" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=500').read())
rules = [v['rule_id'] for t in d['transactions'] for v in t.get('violations', [])]
assert 'WEEKEND_SPEND' in rules, 'No WEEKEND_SPEND violations found'
"

assert_python "At least one DUPLICATE_MERCHANT violation exists" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=500').read())
rules = [v['rule_id'] for t in d['transactions'] for v in t.get('violations', [])]
assert 'DUPLICATE_MERCHANT' in rules, 'No DUPLICATE_MERCHANT violations found'
"

assert_python "At least one HIGH_VELOCITY violation exists" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=500').read())
rules = [v['rule_id'] for t in d['transactions'] for v in t.get('violations', [])]
assert 'HIGH_VELOCITY' in rules, 'No HIGH_VELOCITY violations found'
"

assert_python "Violation objects have required fields (rule_id, severity, description)" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=flagged&limit=5').read())
for t in d['transactions']:
    for v in t.get('violations', []):
        assert 'rule_id' in v, 'Missing rule_id'
        assert 'severity' in v, 'Missing severity'
        assert 'description' in v, 'Missing description'
"

# ── Review state persistence tests ────────────────────────────────────────────

echo ""
echo "--- Review State Persistence ---"

assert_python "POST review → status reflected in GET transactions" "
import urllib.request, json, urllib.error

# Get first flagged transaction
url = 'http://localhost:3000/api/transactions?status=flagged&limit=1'
d = json.loads(urllib.request.urlopen(url).read())
assert len(d['transactions']) > 0, 'No flagged transactions to test with'
txn_id = d['transactions'][0]['id']

# Set to approved
payload = json.dumps({'transaction_id': txn_id, 'review_status': 'approved'}).encode()
req = urllib.request.Request('http://localhost:3000/api/actions/review',
    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
res = urllib.request.urlopen(req)
assert res.status == 200, f'POST failed: {res.status}'

# Check it appears in approved bucket
url2 = 'http://localhost:3000/api/transactions?status=approved&limit=10'
d2 = json.loads(urllib.request.urlopen(url2).read())
ids = [t['id'] for t in d2['transactions']]
assert txn_id in ids, f'Transaction {txn_id} not found in approved bucket'

# Reset back to flagged
payload2 = json.dumps({'transaction_id': txn_id, 'review_status': 'flagged'}).encode()
req2 = urllib.request.Request('http://localhost:3000/api/actions/review',
    data=payload2, headers={'Content-Type': 'application/json'}, method='POST')
urllib.request.urlopen(req2)
"

assert_python "POST review to under_review reflected in counts" "
import urllib.request, json

# Get first flagged transaction
url = 'http://localhost:3000/api/transactions?status=flagged&limit=1'
d = json.loads(urllib.request.urlopen(url).read())
assert len(d['transactions']) > 0, 'No flagged transactions'
txn_id = d['transactions'][0]['id']

# Get initial under_review count
d_before = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=under_review&limit=1').read())
count_before = d_before['total']

# Set to under_review
payload = json.dumps({'transaction_id': txn_id, 'review_status': 'under_review'}).encode()
req = urllib.request.Request('http://localhost:3000/api/actions/review',
    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
urllib.request.urlopen(req)

# Check count increased
d_after = json.loads(urllib.request.urlopen('http://localhost:3000/api/transactions?status=under_review&limit=1').read())
count_after = d_after['total']
assert count_after == count_before + 1, f'Expected {count_before+1} under_review, got {count_after}'

# Reset back to flagged
payload2 = json.dumps({'transaction_id': txn_id, 'review_status': 'flagged'}).encode()
req2 = urllib.request.Request('http://localhost:3000/api/actions/review',
    data=payload2, headers={'Content-Type': 'application/json'}, method='POST')
urllib.request.urlopen(req2)
"

# ── Top offenders shape test ──────────────────────────────────────────────────

echo ""
echo "--- Top Offenders ---"

assert_python "/api/top-offenders returns array with cardholder and count fields" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/top-offenders').read())
assert isinstance(d, list), 'top-offenders must return an array'
assert len(d) > 0, 'top-offenders array is empty'
for entry in d:
    assert 'cardholder' in entry, 'Missing cardholder field'
    assert 'violation_count' in entry, 'Missing violation_count field'
    assert isinstance(entry['violation_count'], int), 'violation_count must be int'
"

# ── Trends shape test ─────────────────────────────────────────────────────────

echo ""
echo "--- Trends ---"

assert_python "/api/trends returns array with date and amount fields" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3000/api/trends').read())
assert isinstance(d, list), 'trends must return an array'
assert len(d) > 0, 'trends array is empty'
for entry in d:
    assert 'date' in entry, 'Missing date field'
    assert 'amount_cents' in entry, 'Missing amount_cents field'
    assert isinstance(entry['amount_cents'], (int, float)), 'amount_cents must be numeric'
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
