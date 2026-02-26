# Operational Learnings

## Environment

- Python venv is at `.venv/` — always use `.venv/bin/python3` and `.venv/bin/pip`
- Server runs on port **3001** (not 3000 — that's ralph-trends)
- Environment variables required: `GITHUB_TOKEN`, `JIRA_EMAIL`, `JIRA_API_TOKEN`

## API Notes

### GitHub API (fetch-github.py)
- Use `GET /repos/{org}/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100` for PRs
- **The PR list endpoint does NOT include `changed_files`, `additions`, `deletions`** — must call `GET /repos/{org}/{repo}/pulls/{number}` (detail endpoint) per PR
- **`review_count` must be `len(reviews)`** — GitHub does not include it in the list or reviews endpoint response; count the reviews fetched from `GET /repos/{org}/{repo}/pulls/{number}/reviews`
- `GET /repos/{org}/{repo}/pulls/{number}/reviews` returns all review events (APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED)
- `GET /repos/{org}/{repo}/pulls/{number}/commits` can return empty for some PRs (empty commits = fallback to created_at)
- Pagination via `Link` header with `rel="next"` — parse carefully (split on `,` then look for `rel="next"`)
- Some repos time out occasionally (network flakiness). Script handles gracefully and continues to next repo.

### Jira API (fetch-jira.py)
- **The old `POST /rest/api/3/search` and `GET /rest/api/3/search` endpoints are REMOVED (HTTP 410)**
- Use `GET /rest/api/3/search/jql?jql=...&maxResults=100&fields=...` for issue search
- Pagination uses **cursor-based pagination**: response includes `nextPageToken` and `isLast` (not `startAt/total`)
- Pass `nextPageToken` as query param to get next page
- Custom field IDs for "Incident Discovered Time" = `customfield_10610`, "Incident Resolution Time" = `customfield_10611` (for paywithextend.atlassian.net)
- Discover field IDs via `GET /rest/api/3/field` — returns list of all fields with `id` and `name`
- Auth: `Authorization: Basic base64(email:token)` header

## Node.js / Express (server.js)

- `require.main === module` guard allows `server.js` to be imported for testing without starting the server
- Static catch-all `app.get(/^(?!\/api).*/, ...)` must come LAST (after all API routes) so API routes are matched first
- `module.exports = { app, getData, reloadData, ...helpers }` — subsequent tasks add API routes to the same `app`; they can import and destructure `getData()` to get `{prs, incidents, repos, goals}`
- ISO week computation: use Thursday rule (`thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3)`)

## Test Suite Patterns

- Use `assert_json_or_skip` / `assert_python_or_skip` to skip tests for endpoints not yet implemented (checks HTTP 404)
- The static catch-all returns `index.html` for all non-/api routes, so unimplemented API routes correctly return 404

## PR Deep Dive Outlier Logic

- `org_median_hours` is computed over the date-range-filtered PRs BEFORE applying repo/search filters
- `outlier_threshold = org_median_hours * 2` — a PR is an outlier if `total_hours > 2 × org_median`
- `github_url` constructed as `https://github.com/{github_org}/{repo}/pull/{pr_number}` where `github_org` comes from `config/repos.json`

## Goals Endpoint Notes

- `GET /api/goals/status` computes `deploys_per_day` in goal_trend as `weekly_deploy_count / 7` (week = 7 days)
- `meeting_goal` for lower-is-better (cycle_time, cfr, mttr): `pct_of_target <= 100`; for higher-is-better (deploy_frequency): `pct_of_target >= 100`
- `PUT /api/goals` validates all 4 fields are positive numbers; returns 400 with `{error, errors: {field: message}}` on failure
- curl `-sf` suppresses 4xx response bodies — use `-s` only when testing error responses

## Known Issues

- One PR out of 577 had files_changed=0 even after fetching detail — likely an actual empty/binary PR. This is expected.
- 245 PRs have review_count=0 — correct, not all PRs go through formal review.

## Reports Endpoint Notes

- `/api/reports/calendar`: filter PRs by `merged_at` (date range); group by `merged_at.slice(0,10)` for YYYY-MM-DD; omit zero-deploy days.
- `/api/reports/flow`: enumerate ISO weeks by walking from Monday of `fromDate` in 7-day increments while cursor <= toDate. For each week, iterate ALL prs (not date-range-filtered) to check state at end of week: in_review = first_review_at <= weekEnd AND merged_at > weekEnd; coding = created_at <= weekEnd AND (first_review_at null or > weekEnd) AND merged_at > weekEnd.
- `/api/reports/incident-correlation`: filter incidents by `created_at`; for each incident find PR with smallest positive `discoveredAt - mergedAt` within 7 days. Use `repos.github_org` for github_url construction.
- `/api/reports/radar`: normalize metrics 0-100. Lower-is-better: `score = max(0, min(100, 100 × (1 - (value - elite) / (medium - elite))))`. Deploy freq: `score = max(0, min(100, 100 × value / elite))`. Previous period = same duration immediately before fromDate. No-data = 100 for lower-is-better, 0 for deploy_freq.
- `/api/reports/digest`: achievements/concerns max 3 each. Sources: tier changes, >15% changes, CFR > 15% absolute. Previous period = same duration immediately before fromDate.
- `POST /api/refresh`: spawns fetch scripts with `spawn('.venv/bin/python3', [...], {cwd: __dirname})`. Both scripts run in parallel. Response sent only after both complete. **Cannot be tested automatically** — requires live GitHub/Jira credentials. Skip in test suite.

## Commit Message vs Reality

- Commits can claim tasks are done when they are not. Always verify endpoints actually exist in server.js (`grep "app.get" server.js`) rather than trusting commit messages. Task 5 was committed but both endpoints were missing.
- Same happened with iteration 11 commit — it was labeled "Task 10: Add GET /api/sanity" but the sanity endpoint was not in server.js. Always grep to confirm before moving on.

## Frontend Routing Notes (Task 11)

- Route key `'advanced'` was renamed to `'reports'` in PAGE_TITLES, PAGE_LOADERS, and keyboard shortcut map. The page div id changed from `page-advanced` to `page-reports`. Sidebar link changed from `#/advanced` to `#/reports`.
- `apiFetch(path, opts = {})` — the second arg is now forwarded to `fetch()`. Required for POST requests (refresh button).
- API returns `trend` (singular), not `trends`. Both `/api/cycle-time` and `/api/deploys` use `trend`.
- Chart.js bubble chart for incidents: Y-axis must be integer indices into a repos array; use `ticks.callback` to display repo names. The canvas must exist in the HTML before `loadReliability()` is called.
- Dead inline `hashchange` script in index.html was removed. The real `hashchange` listener is in app.js. Update tests.sh if any test checked for `'hashchange' in html`.
- tests.sh routing test now checks for `#/reports` (not `#/advanced` or `#/advanced`-or-`#/reports`).

## Loading Skeletons (Task 12)

- `showSkeleton(containerId, rows)` sets the element's `innerHTML` to skeleton divs — this DESTROYS any child elements (thead/tbody in tables, canvases).
- For tables using `showSkeleton`: update population code from `querySelector('tbody').innerHTML = rows` to `getElementById('table-id').innerHTML = '<thead>...</thead><tbody>' + rows + '</tbody>'` to rebuild the full table structure after skeleton destroys it.
- Good skeleton targets per page: `overview-cards` (overview), `slowest-prs-table` (cycle-time), `deploy-heatmap` (deploys), `incidents-table` (reliability), `pr-summary-bar` (pr-deep-dive), `goals-form` (goals), `cal-heatmap` (advanced/reports).
- `@media print` CSS references the page div by ID (`#page-reports`) — if the route is renamed, update the print CSS too. The route was renamed from `advanced` to `reports` in Task 11, but print CSS still said `#page-advanced` until Task 12.

## Final Polish Notes (Task 13)

- `.data-table th` had `cursor: pointer; user-select: none;` but NO `<th>` elements have click handlers anywhere. PR sorting uses a `<select>` dropdown, not column header clicks. Removed `cursor: pointer`; kept `user-select: none` (still useful to prevent text selection on click).
- Font scaling at 480px: added `html { font-size: 12px; }` in the 480px media query. All font-size values are in `rem`, so they scale proportionally with the root.
- Responsive breakpoints are complete: 1024px (2-col grid), 768px (icon-only sidebar), 480px (hidden sidebar + font scale). No gaps at 1280px or 1920px.
- All cursor:pointer elements are backed by handlers: `.time-btn` (addEventListener), `#refresh-btn` (addEventListener), `.btn` (onclick/addEventListener), `.page-btn` (onclick=changePage).

## Sanity Endpoint Notes

- `GET /api/sanity` uses `parseDateRange` + `filterByDateRange` for same date range logic as all other endpoints.
- Checks are wrapped in a `try/catch addCheck()` helper so one check error doesn't prevent others from running.
- Checks 7 and 8 (`zero_deploy_cfr`, `no_incident_mttr`) test edge case behavior inline (not against live data) — they validate the CFR formula with deployCount=0 and median([]) === null.
- Insert sanity endpoint BEFORE the SPA catch-all route `app.get(/^(?!\/api).*/, ...)` so the API route matches correctly.
