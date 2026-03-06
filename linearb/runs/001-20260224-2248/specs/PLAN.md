# Plan

Generated: 2026-02-24T12:45:00Z
Replanned: yes — previous plan was rejected. All PLAN_REVIEW.md blockers and gaps addressed.

## Spec Coverage Map

**Data & API:**
- "fetch-github.py retrieves merged PRs from all 30 configured repos for the last 90 days" → Task 1
- "fetch-jira.py retrieves change_failure issues from Jira project EX" → Task 2
- "Both fetchers handle pagination and rate limiting gracefully" → Tasks 1, 2
- "All READ endpoints return valid JSON with correct DORA calculations" → Tasks 4–10
- "Date range params (from, to) work on all endpoints" → Tasks 3–10 (filter helper in Task 3, used by all endpoint tasks)
- "Metrics are deterministic (same data → same results)" → Task 3 (pure functions, no randomness)

**Pages & Routing:**
- "Hash routing works: #/overview, #/cycle-time, #/deploys, #/reliability, #/pr-deep-dive, #/goals, #/reports" → Task 11 (fixes #/advanced → #/reports)
- "Default route redirects to #/overview" → Existing code (verified in Task 12)
- "Sidebar navigation works with active state" → Existing code (verified in Task 12)
- "Browser back/forward works" → Existing code (verified in Task 12)
- "Each page loads its own data and renders correctly" → Existing code (verified in Task 12), API data provided by Tasks 4–10

**Overview Page:**
- "4 DORA metric cards with values, ratings, and sparklines" → Task 4 (API) + existing frontend
- "Deployment frequency bar chart" → Task 4 (API) + existing frontend
- "Recent incidents and deploys lists" → Task 4 (API) + existing frontend

**Cycle Time Page:**
- "Cycle time trend (weekly medians)" → Task 5 (API) + Task 11 (field name fix)
- "Phase breakdown visualization" → Task 5 (API) + existing frontend
- "Slowest PRs table" → Task 5 (API) + existing frontend
- "Distribution histogram" → Task 5 (API) + existing frontend

**Deploys Page:**
- "Deploy frequency trend" → Task 5 (API) + Task 11 (field name fix)
- "Deploy heatmap (custom rendering, not Chart.js)" → Task 5 (API) + existing frontend (custom HTML table)
- "Repo breakdown table" → Task 5 (API) + existing frontend

**Reliability Page:**
- "CFR and MTTR trends" → Task 6 (API) + existing frontend
- "Incident timeline bubble chart" → Task 6 (API) + Task 11 (adds missing bubble chart)
- "Incident detail table" → Task 6 (API) + existing frontend
- "CFR vs deploy volume chart" → Task 6 (API) + existing frontend

**PR Deep Dive Page:**
- "PR timeline / Gantt chart with phase-colored segments (custom canvas rendering)" → Task 6 (API) + existing frontend (renderGantt canvas function)
- "PR search and filter (text, repo, sort)" → Task 6 (API filtering) + existing frontend
- "PR detail expansion on click" → Task 6 (API) + existing frontend (showPRDetail)
- "Outlier detection with visual flagging" → Task 6 (API is_outlier flag) + existing frontend (red background + indicator)
- "PR size vs cycle time scatter" → Task 6 (API) + Task 11 (X-axis fix to files_changed)

**Goals & Targets Page:**
- "Target configuration with explicit save (PUT /api/goals round-trip works)" → Task 7 (PUT endpoint) + Task 11 (apiFetch fix for POST/PUT)
- "Goal progress gauges (radial/arc) with green/amber/red color coding" → Task 7 (API) + existing frontend (drawGauge)
- "Goal trend over time (actual vs target line charts)" → Task 7 (API) + existing frontend
- "Week-over-week delta cards with directional arrows" → Task 7 (API) + existing frontend

**Advanced Reporting Page:**
- "Calendar heatmap (GitHub-style deploy density per day, custom rendering)" → Task 8 (API) + existing frontend (renderCalendarHeatmap SVG)
- "Cumulative flow diagram (stacked area by phase status)" → Task 8 (API) + existing frontend
- "Throughput vs WIP dual-axis chart" → Task 8 (API) + existing frontend
- "Incident correlation analysis (incident → suspected causing PR)" → Task 8 (API) + existing frontend
- "DORA maturity radar chart (normalized 0-100)" → Task 9 (API) + existing frontend
- "Weekly digest view with Print button (window.print with @media print CSS)" → Task 9 (API) + existing frontend + Task 12 (print CSS verification)

**Metric Sanity Checks:**
- "Cycle time phases sum to total" → Task 10
- "Deployment count matches between overview and deploys page" → Task 10
- "CFR denominator (deploy count) is consistent across all views" → Task 10
- "MTTR values are consistent between reliability page and overview" → Task 10
- "Sparkline data points match the weekly aggregates in trend endpoints" → Task 10
- "Date range filtering produces identical metric values regardless of which endpoint" → Task 10
- "Zero-deploy periods show CFR as 0%, not NaN or undefined" → Tasks 3, 10
- "No-incident periods show MTTR as null/N/A, not 0" → Tasks 3, 10
- "Goal progress percentages are mathematically correct against config/goals.json" → Task 10
- "Sanity check endpoint (GET /api/sanity) validates all of the above" → Task 10

**Cross-Cutting:**
- "Time range picker works and persists across pages" → Existing code (verified in Task 12)
- "DORA rating badges render correctly on all metric cards" → Existing code (verified in Task 12)
- "Data refresh button works (disables during refresh, toasts on completion)" → Task 9 (POST /api/refresh) + Task 11 (apiFetch fix) + existing frontend
- "Keyboard shortcuts work" → Existing code + Task 11 (fixes 'ga' → 'reports')
- "No dead buttons: every cursor:pointer has a handler" → Task 13

**Polish:**
- "Responsive layout (collapses gracefully)" → Task 13
- "Loading states for charts and tables" → Task 12 (verify showSkeleton usage, add if missing)
- "Error states for failed fetches" → Existing code (verified in Task 12)
- "Toast notifications for actions" → Existing code (verified in Task 12)

## Priority Tasks

- [x] **Task 1: Write fetch-github.py.** Fetches merged PRs from all 30 repos in config/repos.json using GitHub REST API v3. For each merged PR: fetches commits (for first_commit_at) and reviews (for first_review_at, approved_at). Handles pagination via Link header, rate limiting via X-RateLimit-Remaining. Only includes PRs merged in last 90 days to default branch. Outputs data/github_prs.json matching ARCHITECTURE.md schema exactly. Reads GITHUB_TOKEN from env var. **Files:** fetch-github.py. **Why:** Data layer must exist before server can compute metrics. **Verify:** `.venv/bin/python3 fetch-github.py && python3 -c "import json; d=json.load(open('data/github_prs.json')); assert isinstance(d, list) and len(d) > 0; assert all(k in d[0] for k in ['repo','pr_number','merged_at','first_commit_at','title','author']); print(f'{len(d)} PRs fetched')"`

- [x] **Task 2: Write fetch-jira.py.** Fetches change_failure issues from Jira project EX using Jira Cloud REST API v3. Discovers custom field IDs for "Incident Discovered Time" and "Incident Resolution Time" by calling GET /rest/api/3/field. Uses JQL: `project = EX AND labels = change_failure AND created >= -90d`. Handles pagination with startAt/maxResults. Outputs data/jira_incidents.json matching ARCHITECTURE.md schema. Reads JIRA_EMAIL and JIRA_API_TOKEN from env vars. **Files:** fetch-jira.py. **Why:** Incident data needed for CFR, MTTR, and reliability page. **Verify:** `.venv/bin/python3 fetch-jira.py && python3 -c "import json; d=json.load(open('data/jira_incidents.json')); assert isinstance(d, list); print(f'{len(d)} incidents fetched')"`

- [x] **Task 3: Create package.json and server.js foundation with computation helpers.** Create package.json with express dependency. Build server.js with: (a) Express on port 3001, static serving from public/, JSON body parser, (b) load data/github_prs.json and data/jira_incidents.json with graceful error handling (missing files → helpful error message), (c) load config/repos.json and config/goals.json, (d) helper functions: filterByDateRange(items, field, from, to), groupByISOWeek(items, dateField), median(arr), computePRPhases(pr) returning {coding_hours, pickup_hours, review_hours, deploy_hours, total_hours} per ARCHITECTURE.md formulas (clamp negatives to 0), doraRating(metric, value) per ARCHITECTURE.md thresholds, generateSparkline(weeklyData, nWeeks=8). Zero-deploy CFR must return 0 (not NaN). No-incident MTTR must return null (not 0). Export app for testing. **Files:** package.json, server.js. **Why:** Foundation for all API endpoints. Every endpoint depends on these helpers. **Verify:** `cd /Users/jonb/extend/ralph-linearb && npm install && node server.js & sleep 2 && curl -sf http://localhost:3001/ | head -1 | grep -q '<!DOCTYPE' && echo 'Static serving OK' && kill %1`

## Standard Tasks

- [x] **Task 4: Add GET /api/overview endpoint to server.js.** Compute all 4 DORA metrics for the date range: cycle time (median of all PR total_hours), deploy frequency (deploys_per_day = count/days), CFR (incident_count/deploy_count × 100, 0 if no deploys), MTTR (median of incident mttr_hours, null if no incidents). Generate 8-week sparklines for each metric. Build deploy_trend (weekly deploy counts). Return recent_incidents (last 5 by created_at with mttr_hours) and recent_deploys (last 10 by merged_at). Response must match ARCHITECTURE.md GET /api/overview contract exactly. **Files:** server.js. **Why:** Overview is the first page users see; validates entire computation pipeline. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/api/overview | python3 -c "import sys,json; d=json.load(sys.stdin); m=d['metrics']; assert all(k in m for k in ['cycle_time','deploy_frequency','cfr','mttr']); assert 'sparkline' in m['cycle_time']; assert 'deploy_trend' in d and 'recent_incidents' in d and 'recent_deploys' in d; print('OK: overview endpoint working')" && kill %1`

- [x] **Task 5: Add GET /api/cycle-time and GET /api/deploys endpoints.** /api/cycle-time: trend (weekly median cycle times), phase_breakdown (weekly median of each phase), slowest_prs (top 10 by total_hours), distribution (7 buckets: <1h, 1-4h, 4-8h, 8-24h, 1-3d, 3-7d, 7d+). /api/deploys: trend (weekly deploy counts), heatmap (day 0-6 × hour 0-23 counts), by_repo (per-repo deploy count + avg files/additions), size_trend (weekly avg files_changed, additions, deletions). Both support from/to date range params. Response schemas must match ARCHITECTURE.md exactly. **Files:** server.js. **Why:** Powers cycle time and deploys pages. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/api/cycle-time | python3 -c "import sys,json; d=json.load(sys.stdin); assert all(k in d for k in ['trend','phase_breakdown','slowest_prs','distribution']); print('cycle-time OK')" && curl -sf http://localhost:3001/api/deploys | python3 -c "import sys,json; d=json.load(sys.stdin); assert all(k in d for k in ['trend','heatmap','by_repo','size_trend']); print('deploys OK')" && kill %1`

- [x] **Task 6: Add GET /api/reliability, /api/pr-deep-dive, /api/prs, /api/incidents endpoints.** /api/reliability: cfr_trend (weekly CFR with incident+deploy counts), mttr_trend (weekly median MTTR), incidents (full list with mttr_hours), cfr_vs_volume (weekly deploys + CFR). /api/pr-deep-dive: support repo, search (title+author substring), sort (total_hours/merged_at/files_changed/additions), order, page, limit params. Compute is_outlier (total_hours > 2× org_median), return outlier_count and org_median_hours. Include github_url for each PR. /api/prs: paginated PR list. /api/incidents: paginated incident list. All match ARCHITECTURE.md contracts. **Files:** server.js. **Why:** Powers reliability and PR deep dive pages — the two most complex data views. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/api/reliability | python3 -c "import sys,json; d=json.load(sys.stdin); assert all(k in d for k in ['cfr_trend','mttr_trend','incidents','cfr_vs_volume']); print('reliability OK')" && curl -sf 'http://localhost:3001/api/pr-deep-dive?limit=5' | python3 -c "import sys,json; d=json.load(sys.stdin); assert all(k in d for k in ['prs','total','outlier_count','org_median_hours']); print('pr-deep-dive OK')" && kill %1`

- [x] **Task 7: Add GET /api/goals, GET /api/goals/status, and PUT /api/goals endpoints.** GET /api/goals: return contents of config/goals.json. GET /api/goals/status: compute current metric values vs targets, pct_of_target (current/target × 100), meeting_goal (pct ≤ 100 for lower-is-better, ≥ 100 for higher-is-better), weekly_deltas (most recent week vs prior), goal_trend (weekly values). PUT /api/goals: validate all 4 values are positive numbers, write to config/goals.json, reload in memory, return {status: "ok"}. Return 400 with inline errors for invalid input. **Files:** server.js. **Why:** Powers goals page with target tracking and editable config. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/api/goals | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'cycle_time_hours' in d; print('goals OK')" && curl -sf http://localhost:3001/api/goals/status | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'metrics' in d and 'weekly_deltas' in d and 'goal_trend' in d; print('goals/status OK')" && curl -sf -X PUT -H 'Content-Type: application/json' -d '{\"cycle_time_hours\":24,\"deploys_per_day\":1,\"cfr_pct\":5,\"mttr_hours\":2}' http://localhost:3001/api/goals | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'; print('PUT goals OK')" && kill %1`

- [x] **Task 8: Add GET /api/reports/calendar, /api/reports/flow, /api/reports/incident-correlation endpoints.** /api/reports/calendar: one entry per day with deploy count (omit zero-deploy days). /api/reports/flow: weekly cumulative flow — coding (PRs opened, not yet reviewed), in_review (PRs with first_review_at but not yet merged), merged (PRs merged that week), total_open (WIP at end of week). Per ARCHITECTURE.md: in_review = PRs with first_review_at not null AND merged_at null at end of that week. /api/reports/incident-correlation: for each incident, find the PR merged closest in time BEFORE incident_discovered_at (within 7 days). Include github_url and hours_before_incident. All match ARCHITECTURE.md contracts. **Files:** server.js. **Why:** Powers three of the six advanced reporting visualizations. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/api/reports/calendar | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'days' in d; print('calendar OK')" && curl -sf http://localhost:3001/api/reports/flow | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'weeks' in d; w=d['weeks'][0] if d['weeks'] else {}; print('flow OK')" && curl -sf http://localhost:3001/api/reports/incident-correlation | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'correlations' in d; print('correlation OK')" && kill %1`

- [x] **Task 9: Add GET /api/reports/radar, GET /api/reports/digest, and POST /api/refresh endpoints.** /api/reports/radar: normalize metrics 0-100. For lower-is-better: score = max(0, 100 × (1 - (value - elite) / (low - elite))), clamped 0-100. For deploy_frequency: score = max(0, 100 × value / elite), clamped 0-100. Return current + previous (equivalent prior period). /api/reports/digest: period metrics with deltas, achievements (top 3: tier improvement, best value this quarter, >15% week-over-week improvement), concerns (top 3: tier drop, >15% regression, CFR >15%). Max 3 each, plain English. POST /api/refresh: spawn `.venv/bin/python3 fetch-github.py` and `.venv/bin/python3 fetch-jira.py` as child processes, reload data files on completion, return {status, prs, incidents, rate_limit_remaining}. **Files:** server.js. **Why:** Completes all API endpoints needed for advanced reporting and data refresh. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/api/reports/radar | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'current' in d and 'previous' in d; print('radar OK')" && curl -sf http://localhost:3001/api/reports/digest | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'metrics' in d and 'achievements' in d and 'concerns' in d; print('digest OK')" && kill %1`

- [x] **Task 10: Add GET /api/sanity endpoint with all 9 validation checks.** Implements every check from ARCHITECTURE.md — each is a real validation, not a stub: (1) cycle_time_phase_sum: verify all PRs have phases summing to total within 0.01h, (2) deploy_count_consistency: overview deploy count matches deploys endpoint, (3) cfr_denominator_consistency: CFR deploy counts match deploy endpoint, (4) mttr_consistency: reliability MTTR matches overview MTTR, (5) sparkline_matches_trends: sparkline values match weekly aggregates, (6) date_filter_consistency: same range produces same values across endpoints, (7) zero_deploy_cfr: 0 deploys → CFR is 0, not NaN, (8) no_incident_mttr: no incidents → MTTR is null, (9) goal_math: goal percentages correct within 0.1%. Return {passed, checks[], summary} per ARCHITECTURE.md contract. **Files:** server.js. **Why:** Validates metric consistency — the most important quality gate. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/api/sanity | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'checks' in d and len(d['checks']) == 9; print(d['summary'])" && kill %1`

- [x] **Task 11: Fix frontend routing and API contract mismatches.** Fix 6 known bugs: (1) Change route from #/advanced to #/reports — update HTML data-route, page div id, JS PAGE_TITLES key, PAGE_LOADERS key, keyboard shortcut 'ga' mapping. (2) Fix apiFetch to accept and pass options: `async function apiFetch(path, opts = {})` then `fetch(path, opts)`. (3) Fix `data.trends` → `data.trend` in loadCycleTime (line ~207) and loadDeploys (line ~269). (4) Add incident timeline bubble chart to reliability page: add canvas element in HTML, add Chart.js bubble chart in loadReliability using X=date, Y=repo (categorical), radius proportional to MTTR (5px min, 25px max per ARCHITECTURE.md). (5) Fix scatter chart X-axis from `p.additions` to `p.files_changed` and update axis label to "Files Changed". (6) Remove duplicate empty hashchange listener from index.html line 329. **Files:** public/index.html, public/app.js. **Why:** Frontend must match API contract and spec requirements. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/ | grep -q 'data-route="reports"' && curl -sf http://localhost:3001/app.js | grep -q 'function apiFetch(path, opts' && curl -sf http://localhost:3001/app.js | grep -q 'data\.trend\.map' && curl -sf http://localhost:3001/ | grep -q 'incident-bubble-chart' && curl -sf http://localhost:3001/app.js | grep -q 'p\.files_changed' && echo 'All frontend fixes verified' && kill %1`

## Polish Tasks

- [x] **Task 12: Verify cross-cutting features and add loading skeletons.** Systematically verify existing code handles: (a) default route → #/overview redirect, (b) sidebar active state toggles on navigation, (c) browser back/forward via hashchange, (d) time range picker persists selection across page changes, (e) DORA rating badges use correct color classes, (f) keyboard shortcuts map to correct routes (all 7 + ? overlay), (g) toast notifications work (success/error/info types), (h) error states show on failed fetches (each page has catch block). Add showSkeleton() calls at the start of each page loader function before async data fetch if not already present. Verify @media print CSS exists in styles.css for weekly digest — if missing, add it (hide sidebar + header, show only digest card). Verify existing features by checking key function/element names exist in source. **Files:** public/app.js, public/styles.css. **Why:** Ensures all existing cross-cutting features work correctly with the new backend and catches any gaps. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/app.js | grep -q 'showSkeleton' && curl -sf http://localhost:3001/styles.css | grep -q '@media print' && curl -sf http://localhost:3001/app.js | grep -q 'renderGantt' && curl -sf http://localhost:3001/app.js | grep -q 'renderCalendarHeatmap' && curl -sf http://localhost:3001/app.js | grep -q 'drawGauge' && echo 'Cross-cutting verified' && kill %1`

- [x] **Task 13: Final polish — responsive layout, dead button audit, loading states.** (a) Verify responsive CSS for 1920px, 1280px, 768px, 480px — add media queries in styles.css if missing (sidebar collapse, grid reflow, font scaling). (b) Audit all `cursor:pointer` elements in styles.css: cross-reference each with addEventListener or onclick in app.js/index.html. Remove cursor:pointer from any element without a handler, or add the missing handler. (c) Ensure loading states are visible (skeleton or spinner) before every async data load. (d) Run GET /api/sanity as final integration check. **Files:** public/styles.css, public/app.js. **Why:** Final quality pass before declaring the project complete. **Verify:** `cd /Users/jonb/extend/ralph-linearb && node server.js & sleep 2 && curl -sf http://localhost:3001/styles.css | grep -q '@media' && curl -sf http://localhost:3001/api/sanity | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']); assert d['passed'], 'Sanity checks failed: ' + str([c for c in d['checks'] if not c['passed']])" && echo 'Final polish verified' && kill %1`

## Discovered Issues

- **Frontend uses `#/advanced` but spec requires `#/reports`.** The sidebar nav, page div ID, JS routing tables, and keyboard shortcut all use "advanced" instead of "reports". This affects routing, keyboard shortcuts, and nav active state.
- **`apiFetch()` ignores second argument.** The refresh button passes `{ method: 'POST' }` but `apiFetch(path)` only accepts one param. The POST request will be sent as GET, causing a 404 or wrong response.
- **Field name mismatch: `data.trends` vs `data.trend`.** The API contract (ARCHITECTURE.md) specifies `trend` (singular) for /api/cycle-time and /api/deploys responses. The frontend accesses `data.trends` (plural). This will cause "Cannot read property 'map' of undefined" errors.
- **Missing incident timeline bubble chart.** The reliability page HTML has no canvas for the bubble chart. The spec requires a Chart.js bubble chart with X=date, Y=repo, radius=MTTR.
- **Scatter chart wrong X-axis.** Uses `p.additions` but spec says X=files_changed. Also axis label says "Additions" instead of "Files Changed".
- **Duplicate hashchange listener.** index.html line 329 adds an empty `hashchange` listener before app.js loads. Harmless but should be removed for cleanliness.
- **No @media print CSS may be missing.** Need to verify styles.css includes print styles for the weekly digest view.

## Notes for Builder

- **Python venv:** Always use `.venv/bin/python3` and `.venv/bin/pip`. The venv already exists.
- **Environment variables:** `GITHUB_TOKEN`, `JIRA_EMAIL`, `JIRA_API_TOKEN` must be set. They're in `.env` file — source it or use `dotenv` pattern.
- **Port 3001:** Not 3000 (that's ralph-trends).
- **Tasks 1 and 2 are independent** — they can be done in either order. Neither depends on the other.
- **server.js will be large** (~800-1000 lines by the end). Tasks 3-10 each add to the same file. Keep code organized with clear section comments.
- **Existing frontend is ~1193 lines in app.js.** Be surgical with fixes in Tasks 11-13 — don't rewrite, just fix the specific bugs.
- **Rate limiting:** GitHub API allows 5000 req/hr authenticated. With 30 repos × (1 PR list + N PR commits + N PR reviews), budget carefully. Consider fetching only recent PRs to limit API calls.
- **Jira custom fields:** Must discover field IDs via `GET /rest/api/3/field` — they're not hardcoded. Search for "Incident Discovered Time" and "Incident Resolution Time" by name.
- **Chart.js version:** CDN loads Chart.js 4.4.0. Use v4 API for any new charts (bubble chart in Task 11).
- **Data file loading:** server.js should reload data files when POST /api/refresh completes. Store data in module-level variables and re-read from disk after fetchers finish.
- **Verify commands:** All verify commands for Tasks 4-13 assume `node server.js` needs to be started first. Pattern: `node server.js & sleep 2 && [curl checks] && kill %1`.
- **npm install:** Must run `npm install` after creating package.json (Task 3). All subsequent tasks assume express is installed.
