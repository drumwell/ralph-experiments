# Review: 2026-02-25

## Blockers

- [BLOCKER] `data.trends` (plural) used in app.js but API returns `data.trend` (singular). `loadCycleTime()` at lines 207, 214 and `loadDeploys()` at lines 269, 270 both call `data.trends.map(...)`. Confirmed: `curl http://localhost:3001/api/cycle-time | python3 -c "import json,sys;d=json.load(sys.stdin);print(list(d.keys()))"` → `['trend', 'phase_breakdown', 'slowest_prs', 'distribution']`. Both the Cycle Time page and Deploys page throw `TypeError: Cannot read properties of undefined (reading 'map')` on load.

- [BLOCKER] `apiFetch` only accepts one argument. Signature at app.js:54: `async function apiFetch(path)`. The refresh button at app.js:1110 calls `apiFetch('/api/refresh', { method: 'POST' })` — the second argument is silently dropped. The underlying `fetch` sends a GET. The Refresh Data button always fails.

- [BLOCKER] Route mismatch: SPEC.md requires `#/reports`, code uses `#/advanced` everywhere. `index.html` sidebar link is `href="#/advanced" data-route="advanced"`. `PAGE_TITLES['advanced']` and `PAGE_LOADERS['advanced']` in app.js. Keyboard shortcut `g a` navigates to `'advanced'`. Navigating to `#/reports` falls back to Overview (navigate() defaults unknown routes to 'overview'). SPEC.md "Done When" requires `#/reports` to work.

- [BLOCKER] Incident bubble chart missing from Reliability page. SPEC.md: "Incident timeline: bubble chart (Chart.js bubble type) of incidents by date (X) and repo (Y), bubble radius proportional to MTTR." ARCHITECTURE.md Behavioral Clarifications confirms. `loadReliability()` has no bubble chart. Confirmed: `grep -n "bubble" public/app.js` → no matches.

- [BLOCKER] Scatter chart X-axis uses `additions` instead of `files_changed`. SPEC.md: "X=files changed, Y=total cycle time hours". app.js:456: `data: data.prs.map(p => ({ x: p.additions, y: p.total_hours }))` labeled "Additions". Expected: `x: p.files_changed`, label: "Files Changed".

- [BLOCKER] All `/api/reports/*` endpoints return 404. Confirmed: `curl http://localhost:3001/api/reports/calendar` → `Cannot GET /api/reports/calendar`. Same for `/flow`, `/incident-correlation`, `/radar`, `/digest`. `grep "reports" server.js` → no matches. `loadAdvanced()` calls all five in parallel — the entire Advanced Reporting page fails to load.

- [BLOCKER] `POST /api/refresh` returns 404. Confirmed: `curl -X POST http://localhost:3001/api/refresh` → `Cannot POST /api/refresh`. server.js has no `app.post('/api/refresh', ...)`. The Refresh Data feature is completely non-functional.

- [BLOCKER] `GET /api/sanity` returns 404. Required by SPEC.md "Done When" checklist: "Sanity check endpoint (`GET /api/sanity`) validates all of the above and returns pass/fail per check." Not implemented.

## Warnings

- [WARNING] Test suite has no coverage for `/api/reports/*` endpoints or `POST /api/refresh`. All 24 tests pass but the 8 missing endpoints are untested. The routing test (tests.sh:373) was intentionally weakened to accept `#/reports` OR `#/advanced` (comment: "may still say 'advanced' until Task 11"), masking a known spec violation.

- [WARNING] STATUS.md commit message mismatch. `git show ace992e -- server.js | grep "^+app.get\|^+app.put\|^+app.post"` shows only goals endpoints (Task 7) were added in commit ace992e, but the commit title is "Task 8: Add GET /api/reports/calendar, /api/reports/flow, /api/reports/incident-correlation endpoints." STATUS.md correctly describes Task 7 as the last completed work; the commit message is wrong.

- [WARNING] Phase breakdown uses independent medians per phase. `phase_breakdown` in `/api/cycle-time` computes `median(coding_hours)`, `median(pickup_hours)`, etc. separately. Sum of individual medians ≠ median of total cycle time, so stacked phase chart and trend chart totals won't match. Acceptable approximation but may confuse stakeholders comparing numbers.

## Nits

- [NIT] Dead no-op hashchange listener in index.html line 329: `<script>window.addEventListener('hashchange', function() {});</script>`. Fires alongside the real handler in app.js. Harmless but confusing.

- [NIT] When `#/advanced` → `#/reports` route is fixed, the keyboard shortcut target at app.js:1167 (`'ga': 'advanced'`) must also be updated to `'reports'`, along with PAGE_TITLES and PAGE_LOADERS keys.

## Passed

- GET /api/overview, /api/cycle-time, /api/deploys, /api/reliability all return correct JSON shapes matching ARCHITECTURE.md contracts
- GET /api/pr-deep-dive with pagination, repo filter, text search (title+author), sort (total_hours/merged_at/files_changed/additions), outlier detection
- GET /api/prs and /api/incidents paginated endpoints
- GET /api/goals returns config; GET /api/goals/status returns metrics/weekly_deltas/goal_trend; PUT /api/goals validates all 4 fields and saves
- Cycle time phase computation: correct max(0) clamping, correct fallback when no approval (uses merged_at - created_at for deploy_hours), correct fallback when no reviews (pickup=0, review=0)
- CFR = 0 when deploy_count = 0 (not NaN/undefined per ARCHITECTURE.md spec)
- MTTR uses custom incident fields with correct fallback to created_at/resolved_at; excludes incidents with null resolutiondate
- DORA rating function matches ARCHITECTURE.md thresholds exactly
- Hash routing works for: overview, cycle-time, deploys, reliability, pr-deep-dive, goals
- PR outlier detection (total_hours > 2× org median) with visual flagging (red dots in scatter, badge in Gantt detail panel)
- Gantt canvas: phase-colored segments (coding=blue, pickup=amber, review=purple, deploy=green), 25 PRs/page, pagination, click-to-expand detail panel
- Goal progress metrics: correct pct_of_target=(current/target)×100, correct meeting_goal direction (lower-is-better vs higher-is-better for deploys_per_day)
- Week-over-week deltas: most recent complete week vs prior week, improved flags correct per metric direction
- Time range picker: module-level state, persists across page navigation, 5 preset buttons + custom date range inputs
- Toast notifications: auto-dismiss, used for refresh and goals save
- Keyboard shortcuts: g o/c/d/r/p/g/a all wired; ? overlay shows/hides
- Deploy heatmap: custom HTML table rendering (not Chart.js) per ARCHITECTURE.md requirement
- Sidebar navigation with active state; browser back/forward via hashchange event
- 24/24 existing tests pass
