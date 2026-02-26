#!/bin/bash
# =============================================================================
# tests.sh — Growing test suite for the DORA Metrics Dashboard
#
# Ralph maintains this file. Add new test cases as features are built.
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

# Skip test if endpoint returns 404 (not yet implemented)
assert_json_or_skip() {
    local description="$1"
    local url="$2"
    local status_code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
    if [[ "$status_code" == "404" ]]; then
        echo "  SKIP: $description (endpoint not yet implemented)"
        return
    fi
    assert_json "$description" "$url"
}

assert_python_or_skip() {
    local description="$1"
    local url_check="$2"
    local code="$3"
    local status_code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "$url_check" 2>/dev/null)
    if [[ "$status_code" == "404" ]]; then
        echo "  SKIP: $description (endpoint not yet implemented)"
        return
    fi
    assert_python "$description" "$code"
}

# ── Setup ────────────────────────────────────────────────────────────────────

echo "=== DORA Metrics Test Suite: $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""

# ── Config tests ─────────────────────────────────────────────────────────────

echo "--- Config ---"

assert_python "config/repos.json exists and is valid JSON" "
import json
d = json.load(open('config/repos.json'))
assert 'github_org' in d, 'Missing github_org'
assert 'github_repos' in d, 'Missing github_repos'
assert len(d['github_repos']) >= 1, 'No repos defined'
assert 'jira_instance' in d, 'Missing jira_instance'
assert 'jira_project' in d, 'Missing jira_project'
assert 'incident_label' in d, 'Missing incident_label'
"

# ── Data integrity tests ────────────────────────────────────────────────────

echo ""
echo "--- Data Files ---"

if [[ -f fetch-github.py ]]; then
    assert_ok "fetch-github.py has valid Python syntax" ".venv/bin/python3 -m py_compile fetch-github.py"
else
    echo "  SKIP: fetch-github.py does not exist yet"
fi

if [[ -f fetch-jira.py ]]; then
    assert_ok "fetch-jira.py has valid Python syntax" ".venv/bin/python3 -m py_compile fetch-jira.py"
else
    echo "  SKIP: fetch-jira.py does not exist yet"
fi

if [[ -f data/github_prs.json ]]; then
    assert_python "github_prs.json is valid with required fields" "
import json
d = json.load(open('data/github_prs.json'))
assert isinstance(d, list), 'Must be array'
assert len(d) > 0, 'Empty PR data'
pr = d[0]
for f in ['repo', 'pr_number', 'title', 'author', 'created_at', 'merged_at', 'first_commit_at']:
    assert f in pr, f'Missing field: {f}'
# Check additional optional fields exist as keys (values may be null)
for f in ['first_review_at', 'approved_at', 'review_count', 'files_changed', 'additions', 'deletions', 'base_branch']:
    assert f in pr, f'Missing field: {f}'
"
else
    echo "  SKIP: data/github_prs.json does not exist yet"
fi

if [[ -f data/jira_incidents.json ]]; then
    assert_python "jira_incidents.json is valid with required fields" "
import json
d = json.load(open('data/jira_incidents.json'))
assert isinstance(d, list), 'Must be array'
# May be empty if no incidents — that's OK
if len(d) > 0:
    inc = d[0]
    for f in ['key', 'summary', 'status', 'labels', 'created_at', 'url']:
        assert f in inc, f'Missing field: {f}'
"
else
    echo "  SKIP: data/jira_incidents.json does not exist yet"
fi

# ── Server tests ─────────────────────────────────────────────────────────────

if [[ ! -f server.js ]]; then
    echo ""
    echo "  SKIP: server.js does not exist yet"
    echo ""
    echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
    if [[ $FAIL -gt 0 ]]; then
        echo ""
        echo "FAILURES:"
        echo -e "$ERRORS"
        exit 1
    fi
    exit 0
fi

# Install deps if needed
[[ -d node_modules ]] || npm install --silent 2>/dev/null

pkill -f "node server.js" 2>/dev/null || true
lsof -ti:3001 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2
node server.js &
SERVER_PID=$!
sleep 2

if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "  FAIL: Server failed to start"
    echo "=== Results: ${PASS} passed, $((FAIL + 1)) failed ==="
    exit 1
fi

# ── API endpoint tests ───────────────────────────────────────────────────────

echo ""
echo "--- Core API Endpoints ---"

assert_json_or_skip "GET /api/overview returns valid JSON" "http://localhost:3001/api/overview"
assert_json_or_skip "GET /api/cycle-time returns valid JSON" "http://localhost:3001/api/cycle-time"
assert_json_or_skip "GET /api/deploys returns valid JSON" "http://localhost:3001/api/deploys"
assert_json_or_skip "GET /api/reliability returns valid JSON" "http://localhost:3001/api/reliability"

# Overview shape
assert_python_or_skip "Overview has metrics with all 4 DORA metrics" "http://localhost:3001/api/overview" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/overview').read())
assert 'metrics' in d, 'Missing metrics'
for m in ['cycle_time', 'deploy_frequency', 'cfr', 'mttr']:
    assert m in d['metrics'], f'Missing metric: {m}'
    assert 'rating' in d['metrics'][m], f'Missing rating for {m}'
assert 'recent_incidents' in d, 'Missing recent_incidents'
assert 'recent_deploys' in d, 'Missing recent_deploys'
"

# Date range filtering
assert_python_or_skip "Overview accepts from/to date params" "http://localhost:3001/api/overview" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/overview?from=2026-01-01&to=2026-02-01').read())
assert 'metrics' in d, 'Missing metrics with date params'
"

echo ""
echo "--- Cycle Time API ---"

assert_python_or_skip "Cycle time endpoint has trend, distribution, slowest_prs" "http://localhost:3001/api/cycle-time" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/cycle-time').read())
assert 'trend' in d, 'Missing trend'
assert 'distribution' in d, 'Missing distribution'
assert 'slowest_prs' in d, 'Missing slowest_prs'
"

echo ""
echo "--- Deploys API ---"

assert_python_or_skip "Deploys endpoint has trend, heatmap, by_repo" "http://localhost:3001/api/deploys" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/deploys').read())
assert 'trend' in d, 'Missing trend'
assert 'heatmap' in d, 'Missing heatmap'
assert 'by_repo' in d, 'Missing by_repo'
"

echo ""
echo "--- Reliability API ---"

assert_python_or_skip "Reliability endpoint has cfr_trend, mttr_trend, incidents" "http://localhost:3001/api/reliability" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/reliability').read())
assert 'cfr_trend' in d, 'Missing cfr_trend'
assert 'mttr_trend' in d, 'Missing mttr_trend'
assert 'incidents' in d, 'Missing incidents'
assert 'cfr_vs_volume' in d, 'Missing cfr_vs_volume'
"

echo ""
echo "--- PR Deep Dive API ---"

assert_python_or_skip "PR deep dive endpoint has prs, total, outlier_count, org_median_hours" "http://localhost:3001/api/pr-deep-dive?limit=5" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/pr-deep-dive?limit=5').read())
assert 'prs' in d, 'Missing prs'
assert 'total' in d, 'Missing total'
assert 'outlier_count' in d, 'Missing outlier_count'
assert 'org_median_hours' in d, 'Missing org_median_hours'
assert 'pages' in d, 'Missing pages'
if len(d['prs']) > 0:
    pr = d['prs'][0]
    assert 'github_url' in pr, 'Missing github_url'
    assert 'is_outlier' in pr, 'Missing is_outlier'
    assert 'total_hours' in pr, 'Missing total_hours'
"

echo ""
echo "--- Paginated Endpoints ---"

assert_python_or_skip "GET /api/prs returns paginated list" "http://localhost:3001/api/prs?limit=10" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/prs?limit=10').read())
assert 'prs' in d, 'Missing prs'
assert 'total' in d, 'Missing total'
assert 'pages' in d, 'Missing pages'
assert 'page' in d, 'Missing page'
"

assert_python_or_skip "GET /api/incidents returns paginated list" "http://localhost:3001/api/incidents" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/incidents').read())
assert 'incidents' in d, 'Missing incidents'
assert 'total' in d, 'Missing total'
assert 'pages' in d, 'Missing pages'
assert 'page' in d, 'Missing page'
"

echo ""
echo "--- Goals API ---"

assert_python_or_skip "GET /api/goals returns goal config with all 4 fields" "http://localhost:3001/api/goals" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/goals').read())
for f in ['cycle_time_hours', 'deploys_per_day', 'cfr_pct', 'mttr_hours']:
    assert f in d, f'Missing field: {f}'
    assert d[f] > 0, f'{f} must be positive'
"

assert_python_or_skip "GET /api/goals/status has metrics, weekly_deltas, goal_trend" "http://localhost:3001/api/goals/status" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/goals/status').read())
assert 'metrics' in d, 'Missing metrics'
assert 'weekly_deltas' in d, 'Missing weekly_deltas'
assert 'goal_trend' in d, 'Missing goal_trend'
for m in ['cycle_time', 'deploy_frequency', 'cfr', 'mttr']:
    assert m in d['metrics'], f'Missing metric: {m}'
    met = d['metrics'][m]
    assert 'current' in met, f'Missing current in {m}'
    assert 'target' in met, f'Missing target in {m}'
    assert 'meeting_goal' in met, f'Missing meeting_goal in {m}'
    assert 'pct_of_target' in met, f'Missing pct_of_target in {m}'
    assert m in d['weekly_deltas'], f'Missing {m} in weekly_deltas'
"

assert_python_or_skip "PUT /api/goals saves goals and returns ok" "http://localhost:3001/api/goals" "
import urllib.request, json
body = json.dumps({'cycle_time_hours': 24, 'deploys_per_day': 1.0, 'cfr_pct': 5, 'mttr_hours': 2}).encode()
req = urllib.request.Request('http://localhost:3001/api/goals', data=body, method='PUT', headers={'Content-Type': 'application/json'})
d = json.loads(urllib.request.urlopen(req).read())
assert d['status'] == 'ok', f'Expected ok, got: {d}'
"

assert_python_or_skip "PUT /api/goals rejects invalid input with 400" "http://localhost:3001/api/goals" "
import urllib.request, json
body = json.dumps({'cycle_time_hours': -1, 'deploys_per_day': 1.0, 'cfr_pct': 5, 'mttr_hours': 2}).encode()
req = urllib.request.Request('http://localhost:3001/api/goals', data=body, method='PUT', headers={'Content-Type': 'application/json'})
try:
    urllib.request.urlopen(req)
    assert False, 'Expected 400'
except urllib.error.HTTPError as e:
    assert e.code == 400, f'Expected 400, got {e.code}'
    d = json.loads(e.read())
    assert 'errors' in d, 'Missing errors in response'
"

# ── Reports API ──────────────────────────────────────────────────────────────

echo ""
echo "--- Reports API ---"

assert_python_or_skip "GET /api/reports/calendar returns days array" "http://localhost:3001/api/reports/calendar" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/reports/calendar').read())
assert 'days' in d, 'Missing days'
assert isinstance(d['days'], list), 'days is not a list'
if d['days']:
    day = d['days'][0]
    assert 'date' in day and 'count' in day, f'day missing fields: {day}'
    assert day['count'] > 0, 'Zero-deploy days should be omitted'
"

assert_python_or_skip "GET /api/reports/flow returns weeks with required fields" "http://localhost:3001/api/reports/flow" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/reports/flow').read())
assert 'weeks' in d, 'Missing weeks'
assert isinstance(d['weeks'], list), 'weeks is not a list'
if d['weeks']:
    w = d['weeks'][0]
    for f in ['week', 'coding', 'in_review', 'merged', 'total_open']:
        assert f in w, f'week missing field: {f}'
    assert w['total_open'] == w['coding'] + w['in_review'], 'total_open != coding + in_review'
"

assert_python_or_skip "GET /api/reports/incident-correlation returns correlations" "http://localhost:3001/api/reports/incident-correlation" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/reports/incident-correlation').read())
assert 'correlations' in d, 'Missing correlations'
assert isinstance(d['correlations'], list), 'correlations is not a list'
for c in d['correlations']:
    assert 'incident_key' in c, f'Missing incident_key: {c}'
    assert 'incident_summary' in c, f'Missing incident_summary: {c}'
    assert 'suspected_pr' in c, f'Missing suspected_pr: {c}'
    if c['suspected_pr'] is not None:
        sp = c['suspected_pr']
        for f in ['repo', 'pr_number', 'title', 'merged_at', 'hours_before_incident', 'github_url']:
            assert f in sp, f'suspected_pr missing field: {f}'
        assert sp['hours_before_incident'] >= 0, 'hours_before_incident must be non-negative'
        assert sp['hours_before_incident'] <= 168, 'hours_before_incident must be <= 168 (7 days)'
"

assert_python_or_skip "GET /api/reports/radar returns current and previous scores" "http://localhost:3001/api/reports/radar" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/reports/radar').read())
assert 'current' in d, 'Missing current'
assert 'previous' in d, 'Missing previous'
for period in [d['current'], d['previous']]:
    for f in ['cycle_time', 'deploy_frequency', 'cfr', 'mttr']:
        assert f in period, f'Missing field: {f}'
        assert 0 <= period[f] <= 100, f'{f} score out of range: {period[f]}'
"

assert_python_or_skip "GET /api/reports/digest returns metrics, achievements, concerns" "http://localhost:3001/api/reports/digest" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/reports/digest').read())
assert 'period' in d, 'Missing period'
assert 'metrics' in d, 'Missing metrics'
assert 'achievements' in d, 'Missing achievements'
assert 'concerns' in d, 'Missing concerns'
assert isinstance(d['achievements'], list), 'achievements not a list'
assert isinstance(d['concerns'], list), 'concerns not a list'
assert len(d['achievements']) <= 3, 'Too many achievements'
assert len(d['concerns']) <= 3, 'Too many concerns'
for m in ['cycle_time', 'deploy_frequency', 'cfr', 'mttr']:
    assert m in d['metrics'], f'Missing metric: {m}'
"

# POST /api/refresh spawns real fetch scripts requiring live credentials — not testable in automated suite.
# Verified manually: endpoint exists and returns {"status": "ok|error", ...}.

assert_python_or_skip "GET /api/sanity returns 9 checks all passed" "http://localhost:3001/api/sanity" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/sanity').read())
assert 'checks' in d, 'Missing checks'
assert 'passed' in d, 'Missing passed'
assert 'summary' in d, 'Missing summary'
assert len(d['checks']) == 9, f'Expected 9 checks, got {len(d[\"checks\"])}'
for c in d['checks']:
    assert 'name' in c and 'passed' in c and 'detail' in c, f'Check missing fields: {c}'
failed = [c for c in d['checks'] if not c['passed']]
assert len(failed) == 0, f'Failed checks: {failed}'
assert d['passed'] == True, f'Sanity not passed: {d[\"summary\"]}'
"

# ── Static serving ───────────────────────────────────────────────────────────

echo ""
echo "--- Static Serving ---"

if curl -sf http://localhost:3001/ >/tmp/test_dora.html 2>&1; then
    if grep -q '<html' /tmp/test_dora.html 2>/dev/null; then
        echo "  PASS: GET / returns HTML"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: GET / returns HTML (no <html tag)"
        ERRORS="${ERRORS}\n  - GET / returns HTML"
        FAIL=$((FAIL + 1))
    fi
else
    echo "  FAIL: GET / returns HTML (curl failed)"
    ERRORS="${ERRORS}\n  - GET / returns HTML"
    FAIL=$((FAIL + 1))
fi

# ── Routing tests ────────────────────────────────────────────────────────────

echo ""
echo "--- Client-Side Routing ---"

assert_python "HTML has hash routes for all pages" "
import urllib.request
html = urllib.request.urlopen('http://localhost:3001/').read().decode()
# Check all 7 routes present in HTML (Task 11: #/advanced renamed to #/reports)
for route in ['#/overview', '#/cycle-time', '#/deploys', '#/reliability', '#/pr-deep-dive', '#/goals', '#/reports']:
    assert route in html, f'Missing route: {route}'
# Verify incident bubble chart canvas added in Task 11
assert 'incident-bubble-chart' in html, 'Missing incident bubble chart canvas'
"

# ── DORA rating tests ────────────────────────────────────────────────────────

echo ""
echo "--- DORA Ratings ---"

assert_python_or_skip "DORA ratings are valid values" "http://localhost:3001/api/overview" "
import urllib.request, json
d = json.loads(urllib.request.urlopen('http://localhost:3001/api/overview').read())
valid_ratings = {'elite', 'high', 'medium', 'low'}
for m in ['cycle_time', 'deploy_frequency', 'cfr', 'mttr']:
    rating = d['metrics'][m]['rating']
    assert rating in valid_ratings, f'{m} has invalid rating: {rating}'
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
