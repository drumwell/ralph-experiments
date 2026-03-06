# Test Results

Run at: 2026-02-25 05:07:04 (iteration 14)
Exit code: 0

## Status: ALL TESTS PASSED

## Output
```
=== DORA Metrics Test Suite: 2026-02-25 05:06:57 ===

--- Config ---
  PASS: config/repos.json exists and is valid JSON

--- Data Files ---
  PASS: fetch-github.py has valid Python syntax
  PASS: fetch-jira.py has valid Python syntax
  PASS: github_prs.json is valid with required fields
  PASS: jira_incidents.json is valid with required fields
Loaded 577 PRs from data/github_prs.json
Loaded 3 incidents from data/jira_incidents.json
DORA metrics server running on http://localhost:3001

--- Core API Endpoints ---
  PASS: GET /api/overview returns valid JSON
  PASS: GET /api/cycle-time returns valid JSON
  PASS: GET /api/deploys returns valid JSON
  PASS: GET /api/reliability returns valid JSON
  PASS: Overview has metrics with all 4 DORA metrics
  PASS: Overview accepts from/to date params

--- Cycle Time API ---
  PASS: Cycle time endpoint has trend, distribution, slowest_prs

--- Deploys API ---
  PASS: Deploys endpoint has trend, heatmap, by_repo

--- Reliability API ---
  PASS: Reliability endpoint has cfr_trend, mttr_trend, incidents

--- PR Deep Dive API ---
  PASS: PR deep dive endpoint has prs, total, outlier_count, org_median_hours

--- Paginated Endpoints ---
  PASS: GET /api/prs returns paginated list
  PASS: GET /api/incidents returns paginated list

--- Goals API ---
  PASS: GET /api/goals returns goal config with all 4 fields
  PASS: GET /api/goals/status has metrics, weekly_deltas, goal_trend
  PASS: PUT /api/goals saves goals and returns ok
  PASS: PUT /api/goals rejects invalid input with 400

--- Reports API ---
  PASS: GET /api/reports/calendar returns days array
  PASS: GET /api/reports/flow returns weeks with required fields
  PASS: GET /api/reports/incident-correlation returns correlations
  PASS: GET /api/reports/radar returns current and previous scores
  PASS: GET /api/reports/digest returns metrics, achievements, concerns
  PASS: GET /api/sanity returns 9 checks all passed

--- Static Serving ---
  PASS: GET / returns HTML

--- Client-Side Routing ---
  PASS: HTML has hash routes for all pages

--- DORA Ratings ---
  PASS: DORA ratings are valid values

=== Results: 30 passed, 0 failed ===
ALL TESTS PASSED
```
