# Architecture: Invariants and Constraints

This file defines the patterns and rules that **must not change** across iterations.
If you are tempted to refactor the architecture, STOP — read this file first.

## System Topology

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────────────┐
│ fetch-github.py  │────▶│ data/            │────▶│ server.js                    │
│ (Python)         │     │ github_prs.json  │     │ (Express:3001)               │
└──────────────────┘     │                  │     │                              │
┌──────────────────┐     │ jira_incidents   │     │ READ endpoints:              │
│ fetch-jira.py    │────▶│ .json            │     │ ├─ /api/overview             │
│ (Python)         │     └──────────────────┘     │ ├─ /api/cycle-time           │
└──────────────────┘                               │ ├─ /api/deploys              │
                                                   │ ├─ /api/reliability          │
┌──────────────────┐                               │ ├─ /api/pr-deep-dive         │
│ config/          │──────────────────────────────▶│ ├─ /api/teams                │
│ repos.json       │                               │ ├─ /api/goals                │
│ teams.json       │                               │ ├─ /api/goals/status         │
│ goals.json       │                               │ ├─ /api/reports/*            │
└──────────────────┘                               │ ├─ /api/sanity               │
                                                   │ ├─ /api/prs                  │
                                                   │ ├─ /api/incidents            │
                                                   │                              │
                                                   │ WRITE endpoints:             │
                                                   │ ├─ POST /api/refresh         │
                                                   │ ├─ PUT /api/goals            │
                                                   │ └─ /* (static)               │
                                                   └────────┬─────────────────────┘
                                                            │
                                                   ┌────────▼─────────┐
                                                   │ public/          │
                                                   │ *.html, *.js,    │
                                                   │ *.css            │
                                                   │ (Chart.js CDN)   │
                                                   └──────────────────┘
```

## Data Flow (DO NOT CHANGE)

1. `fetch-github.py` calls GitHub API → writes `data/github_prs.json`
2. `fetch-jira.py` calls Jira API → writes `data/jira_incidents.json`
3. `server.js` reads both JSON files + `config/repos.json` + `config/goals.json` on startup → computes DORA metrics → serves READ endpoints
4. `public/` frontend files fetch from `/api/*` → render UI

Data flows in ONE direction for reads. The frontend never writes files. Write actions go through `/api/refresh` and `PUT /api/goals` only.

## Configuration

### config/repos.json

```json
{
  "github_org": "paywithextend",
  "jira_instance": "paywithextend.atlassian.net",
  "jira_project": "EX",
  "incident_label": "change_failure",
  "default_lookback_days": 90,
  "exclude_repos": []
}
```

Repos are discovered dynamically from the GitHub org API (`GET /orgs/{org}/repos?type=sources`). Archived repos are excluded automatically. `exclude_repos` is an optional list of repo names to skip.

### config/teams.json

```json
{
  "teams": {
    "TeamName": ["github-username-1", "github-username-2"]
  },
  "known_bots": ["extend-buildbot", "extend-github-bot", "Copilot", "dependabot", "renovate"],
  "exclude_bots": true
}
```

Teams map GitHub usernames to team names. All PR-based metrics can be filtered by team via the `?team=` query parameter. CFR and MTTR are always org-wide (incidents aren't team-attributed). The `/api/sanity` endpoint flags PR authors not assigned to any team. Bot accounts are excluded from metrics when `exclude_bots` is true.

### config/goals.json

```json
{
  "cycle_time_hours": 24,
  "deploys_per_day": 1.0,
  "cfr_pct": 5,
  "mttr_hours": 2
}
```

Goal values represent the target threshold for each metric. For cycle_time_hours, cfr_pct, and mttr_hours, lower is better (meeting goal = value ≤ target). For deploys_per_day, higher is better (meeting goal = value ≥ target).

Goals are editable via the Goals page UI, which writes back to `config/goals.json` via the `PUT /api/goals` endpoint.

## GitHub API Access

- **Auth:** `GITHUB_TOKEN` env var. Passed as `Authorization: Bearer <token>` header.
- **Base URL:** `https://api.github.com`
- **Rate limit:** 5000 requests/hour for authenticated requests. Check `X-RateLimit-Remaining` header.
- **Endpoints used:**
  - `GET /repos/{owner}/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100` — merged PRs
  - `GET /repos/{owner}/{repo}/pulls/{number}/commits` — PR commits
  - `GET /repos/{owner}/{repo}/pulls/{number}/reviews` — PR reviews
- **Pagination:** Follow `Link` header with `rel="next"` or use `page` query param.

### fetch-github.py Output Schema

```json
[
  {
    "repo": "repo-name",
    "pr_number": 123,
    "title": "Add feature X",
    "author": "github-username",
    "created_at": "2026-01-15T10:30:00Z",
    "merged_at": "2026-01-16T14:00:00Z",
    "first_commit_at": "2026-01-14T09:00:00Z",
    "first_review_at": "2026-01-15T15:00:00Z",
    "approved_at": "2026-01-16T11:00:00Z",
    "review_count": 2,
    "files_changed": 5,
    "additions": 120,
    "deletions": 30,
    "base_branch": "main"
  }
]
```

**Field computation:**
- `first_commit_at`: Earliest `commit.author.date` from PR commits. If no commits (empty PR), use `created_at`.
- `first_review_at`: Earliest `submitted_at` from PR reviews where `state` is `APPROVED`, `CHANGES_REQUESTED`, or `COMMENTED`. If no reviews, `null`.
- `approved_at`: Latest `submitted_at` from PR reviews where `state` is `APPROVED` BEFORE `merged_at`. If never approved, `null`.
- Only include PRs where `merged_at` is not null (skip closed-but-not-merged PRs).
- Only include PRs merged into the default branch (main or master).

**Repo list:** `fetch-github.py` reads `config/repos.json` and fetches PRs from all repos listed in `github_repos`.

## Jira API Access

- **Auth:** Basic Auth with `JIRA_EMAIL` and `JIRA_API_TOKEN` env vars. Header: `Authorization: Basic base64(email:token)`.
- **Base URL:** `https://paywithextend.atlassian.net/rest/api/3`
- **Endpoints used:**
  - `POST /rest/api/3/search` — JQL search for issues
- **Pagination:** Use `startAt` and `maxResults` params (max 100 per page).

### JQL Query

```
project = EX AND labels = change_failure ORDER BY created DESC
```

Add date filter when fetching recent data:
```
project = EX AND labels = change_failure AND created >= -90d ORDER BY created DESC
```

### Custom Fields

The Jira instance has custom fields for incident timing:
- **"Incident Discovered Time"** — datetime field (custom field ID TBD, discover via API)
- **"Incident Resolution Time"** — datetime field (custom field ID TBD, discover via API)

`fetch-jira.py` must discover these custom field IDs by calling `GET /rest/api/3/field` and searching for fields named "Incident Discovered Time" and "Incident Resolution Time". Cache the field IDs for subsequent requests.

### fetch-jira.py Output Schema

```json
[
  {
    "key": "EX-38290",
    "summary": "CFR: Elevated Errors in Screening Service due to Code Refactor",
    "status": "Done",
    "priority": "Medium",
    "type": "Customer Support Bug",
    "reporter": "Matt Yeh",
    "labels": ["change_failure"],
    "components": ["Sanctions Screening"],
    "created_at": "2026-02-02T00:00:00Z",
    "resolved_at": "2026-02-02T00:00:00Z",
    "incident_discovered_at": "2026-01-30T16:12:00Z",
    "incident_resolved_at": "2026-01-30T18:09:00Z",
    "url": "https://paywithextend.atlassian.net/browse/EX-38290"
  }
]
```

**Field computation:**
- `incident_discovered_at`: Value of the "Incident Discovered Time" custom field. If null, fall back to `created_at`.
- `incident_resolved_at`: Value of the "Incident Resolution Time" custom field. If null, fall back to `resolved_at`.
- `resolved_at`: Issue's `resolutiondate` field.
- `url`: Constructed from instance URL + issue key.

## DORA Metric Computation (FROZEN)

All computation happens in `server.js` from the cached JSON data.

### Cycle Time

For each merged PR:
```
coding_hours   = max(0, (created_at - first_commit_at)) in hours
pickup_hours   = max(0, (first_review_at - created_at)) in hours  [0 if no reviews]
review_hours   = max(0, (approved_at - first_review_at)) in hours [0 if no reviews or no approval]
deploy_hours   = max(0, (merged_at - approved_at)) in hours       [0 if no approval; use merged_at - created_at]
total_hours    = coding_hours + pickup_hours + review_hours + deploy_hours
```

Aggregate per period: use **median** (not mean) to reduce skew from outlier PRs.

### Deployment Frequency

```
deploys_per_period = count of merged PRs in period
```

For rating: compute `deploys_per_day = deploys_in_period / days_in_period`.

### Change Failure Rate

```
cfr_pct = (incident_count_in_period / deploy_count_in_period) * 100
```

If `deploy_count_in_period` is 0, CFR is 0 (no deploys = no failures).

### MTTR

For each incident:
```
mttr_hours = (incident_resolved_at - incident_discovered_at) in hours
```

Aggregate: use **median** MTTR per period.

If both custom datetime fields are null, fall back to `resolved_at - created_at`.

### DORA Rating Function

```javascript
function doraRating(metric, value) {
  const thresholds = {
    cycle_time_hours:   { elite: 24, high: 168, medium: 720 },
    deploys_per_day:    { elite: 1, high: 0.14, medium: 0.033 },
    cfr_pct:            { elite: 5, high: 10, medium: 15 },
    mttr_hours:         { elite: 1, high: 24, medium: 168 }
  };
  const t = thresholds[metric];
  if (metric === 'deploys_per_day') {
    if (value >= t.elite) return 'elite';
    if (value >= t.high) return 'high';
    if (value >= t.medium) return 'medium';
    return 'low';
  }
  if (value <= t.elite) return 'elite';
  if (value <= t.high) return 'high';
  if (value <= t.medium) return 'medium';
  return 'low';
}
```

Rating colors: Elite = `#10b981` (green), High = `#3b82f6` (blue), Medium = `#f59e0b` (amber), Low = `#ef4444` (red).

## API Contract

### Date Range Filtering

All READ endpoints accept optional `from` and `to` query parameters:
- `from`: ISO 8601 date string. Include data on or after this date.
- `to`: ISO 8601 date string. Include data on or before this date.
- If omitted, default to last 90 days.
- For PRs, filter by `merged_at`. For incidents, filter by `created_at`.

### Team Filtering

All PR-based READ endpoints accept an optional `team` query parameter:
- `team`: Team name from `config/teams.json`. Filters PRs to authors in that team.
- If omitted or empty, returns org-wide data.
- If an invalid team name is provided, returns 400 with `{ "error": "Unknown team: ..." }`.
- CFR and MTTR are always org-wide regardless of team filter (incidents aren't team-attributed).
- `/api/incidents` and `/api/sanity` do not accept the `team` parameter.

### READ Endpoints

#### GET /api/overview?from=&to=
```json
{
  "metrics": {
    "cycle_time": { "median_hours": 18.5, "rating": "high", "sparkline": [20, 18, 22, 15, 19, 16, 18, 17] },
    "deploy_frequency": { "deploys_per_day": 2.3, "total_deploys": 161, "rating": "elite", "sparkline": [14, 18, 12, 20, 15, 17, 19, 16] },
    "cfr": { "pct": 4.2, "incident_count": 7, "deploy_count": 161, "rating": "elite", "sparkline": [5, 3, 6, 4, 2, 5, 3, 4] },
    "mttr": { "median_hours": 2.1, "rating": "high", "sparkline": [3, 2, 4, 1, 3, 2, 2, 2] }
  },
  "deploy_trend": [
    { "week": "2026-W01", "count": 14 }
  ],
  "recent_incidents": [
    { "key": "EX-38290", "summary": "...", "status": "Done", "priority": "Medium", "mttr_hours": 1.95, "created_at": "...", "url": "..." }
  ],
  "recent_deploys": [
    { "repo": "...", "pr_number": 123, "title": "...", "author": "...", "merged_at": "..." }
  ]
}
```

`sparkline` arrays contain 8 data points (8 weeks of weekly aggregates within the selected date range).

#### GET /api/cycle-time?from=&to=
```json
{
  "trend": [
    { "week": "2026-W01", "median_hours": 18.5 }
  ],
  "phase_breakdown": [
    { "week": "2026-W01", "coding_hours": 8, "pickup_hours": 3, "review_hours": 5, "deploy_hours": 0.5 }
  ],
  "slowest_prs": [
    { "repo": "...", "pr_number": 123, "title": "...", "author": "...", "total_hours": 120, "merged_at": "..." }
  ],
  "distribution": [
    { "bucket": "<1h", "count": 5 },
    { "bucket": "1-4h", "count": 18 },
    { "bucket": "4-8h", "count": 22 },
    { "bucket": "8-24h", "count": 35 },
    { "bucket": "1-3d", "count": 28 },
    { "bucket": "3-7d", "count": 12 },
    { "bucket": "7d+", "count": 4 }
  ]
}
```

#### GET /api/deploys?from=&to=
```json
{
  "trend": [
    { "week": "2026-W01", "count": 22 }
  ],
  "heatmap": [
    { "day": 0, "hour": 9, "count": 5 }
  ],
  "by_repo": [
    { "repo": "repo-name", "count": 25, "avg_files_changed": 4.2, "avg_additions": 85 }
  ],
  "size_trend": [
    { "week": "2026-W01", "avg_files_changed": 4.5, "avg_additions": 90, "avg_deletions": 30 }
  ]
}
```

`heatmap`: `day` is 0-6 (Sunday-Saturday), `hour` is 0-23.

#### GET /api/reliability?from=&to=
```json
{
  "cfr_trend": [
    { "week": "2026-W01", "pct": 5.0, "incidents": 1, "deploys": 20 }
  ],
  "mttr_trend": [
    { "week": "2026-W01", "median_hours": 1.8 }
  ],
  "incidents": [
    {
      "key": "EX-38290", "summary": "...", "priority": "Medium",
      "created_at": "...", "incident_discovered_at": "...", "incident_resolved_at": "...",
      "mttr_hours": 1.95, "url": "..."
    }
  ],
  "cfr_vs_volume": [
    { "week": "2026-W01", "deploys": 20, "cfr_pct": 5.0 }
  ]
}
```

#### GET /api/pr-deep-dive?from=&to=&repo=&search=&sort=total_hours&order=desc&page=1&limit=50
```json
{
  "prs": [
    {
      "repo": "...", "pr_number": 123, "title": "...", "author": "...",
      "created_at": "...", "merged_at": "...", "first_commit_at": "...", "first_review_at": "...", "approved_at": "...",
      "total_hours": 14.5, "coding_hours": 8, "pickup_hours": 2, "review_hours": 4, "deploy_hours": 0.5,
      "files_changed": 5, "additions": 120, "deletions": 30, "review_count": 2,
      "is_outlier": false, "github_url": "https://github.com/paywithextend/repo/pull/123"
    }
  ],
  "total": 120,
  "page": 1,
  "pages": 3,
  "outlier_count": 8,
  "org_median_hours": 18.5
}
```

`is_outlier` is true if `total_hours > 2 × org_median_hours`. `search` matches PR title and author (case-insensitive substring). `sort` accepts: `total_hours`, `merged_at`, `files_changed`, `additions`.

#### GET /api/goals
```json
{
  "cycle_time_hours": 24,
  "deploys_per_day": 1.0,
  "cfr_pct": 5,
  "mttr_hours": 2
}
```

#### GET /api/goals/status?from=&to=
```json
{
  "metrics": {
    "cycle_time": { "current": 16.2, "target": 24, "meeting_goal": true, "pct_of_target": 67.5 },
    "deploy_frequency": { "current": 2.3, "target": 1.0, "meeting_goal": true, "pct_of_target": 230.0 },
    "cfr": { "current": 4.2, "target": 5, "meeting_goal": true, "pct_of_target": 84.0 },
    "mttr": { "current": 2.1, "target": 2, "meeting_goal": false, "pct_of_target": 105.0 }
  },
  "weekly_deltas": {
    "cycle_time": { "previous": 18.5, "current": 16.2, "delta_pct": -12.4, "improved": true },
    "deploy_frequency": { "previous": 2.0, "current": 2.3, "delta_pct": 15.0, "improved": true },
    "cfr": { "previous": 5.0, "current": 4.2, "delta_pct": -16.0, "improved": true },
    "mttr": { "previous": 1.8, "current": 2.1, "delta_pct": 16.7, "improved": false }
  },
  "goal_trend": [
    { "week": "2026-W01", "cycle_time_hours": 20.1, "deploys_per_day": 1.8, "cfr_pct": 6.0, "mttr_hours": 2.5 }
  ]
}
```

`pct_of_target`: `(current / target) × 100`. Meeting goal when pct ≤ 100 for lower-is-better, or pct ≥ 100 for higher-is-better. `weekly_deltas` compare the most recent complete week to the week before. `goal_trend` provides weekly values for the trend-vs-target chart.

#### GET /api/reports/calendar?from=&to=
```json
{
  "days": [
    { "date": "2026-01-15", "count": 5 }
  ]
}
```

One entry per day with at least one deploy. Days with zero deploys omitted (frontend fills gaps).

#### GET /api/reports/flow?from=&to=
```json
{
  "weeks": [
    { "week": "2026-W01", "coding": 12, "in_review": 8, "merged": 15, "total_open": 20 }
  ]
}
```

`coding` = PRs opened but not yet in review. `in_review` = PRs with at least one review but not yet merged. `merged` = PRs merged that week. `total_open` = WIP at end of week.

#### GET /api/reports/incident-correlation?from=&to=
```json
{
  "correlations": [
    {
      "incident_key": "EX-38290",
      "incident_summary": "...",
      "incident_discovered_at": "...",
      "suspected_pr": {
        "repo": "...", "pr_number": 456, "title": "...", "author": "...",
        "merged_at": "...", "hours_before_incident": 2.5,
        "github_url": "..."
      }
    }
  ]
}
```

For each incident, find the PR merged closest in time BEFORE `incident_discovered_at`. If no PR found within 7 days, `suspected_pr` is null.

#### GET /api/reports/radar?from=&to=
```json
{
  "current": { "cycle_time": 85, "deploy_frequency": 72, "cfr": 90, "mttr": 65 },
  "previous": { "cycle_time": 78, "deploy_frequency": 65, "cfr": 85, "mttr": 70 }
}
```

Normalized 0-100 where 100 = Elite. `current` = selected period, `previous` = equivalent-length period before. For lower-is-better: `score = max(0, 100 × (1 - (value - elite) / (low - elite)))`, clamped 0-100. For deploy_frequency: `score = max(0, 100 × value / elite)`, clamped 0-100.

#### GET /api/reports/digest?from=&to=
```json
{
  "period": { "from": "2026-02-01", "to": "2026-02-24" },
  "metrics": {
    "cycle_time": { "median_hours": 18.5, "rating": "high", "delta_pct": -8.2, "improved": true },
    "deploy_frequency": { "deploys_per_day": 2.3, "rating": "elite", "delta_pct": 12.0, "improved": true },
    "cfr": { "pct": 4.2, "rating": "elite", "delta_pct": -15.0, "improved": true },
    "mttr": { "median_hours": 2.1, "rating": "high", "delta_pct": 5.0, "improved": false }
  },
  "achievements": ["Achieved Elite CFR (4.2%) — best this quarter"],
  "concerns": ["MTTR increased 5% — now at 2.1 hours"]
}
```

`delta_pct` compares selected period to equivalent-length period prior. Max 3 achievements and 3 concerns.

#### GET /api/sanity?from=&to=
```json
{
  "passed": true,
  "checks": [
    { "name": "cycle_time_phase_sum", "passed": true, "detail": "All PRs: phases sum to total within 0.01h" },
    { "name": "deploy_count_consistency", "passed": true, "detail": "Overview (161) = deploys endpoint (161)" },
    { "name": "cfr_denominator_consistency", "passed": true, "detail": "CFR deploy counts match deploy endpoint" },
    { "name": "mttr_consistency", "passed": true, "detail": "Reliability MTTR matches overview MTTR" },
    { "name": "sparkline_matches_trends", "passed": true, "detail": "Sparklines match weekly aggregates" },
    { "name": "date_filter_consistency", "passed": true, "detail": "Same range = same values across endpoints" },
    { "name": "zero_deploy_cfr", "passed": true, "detail": "0 deploys → CFR is 0, not NaN" },
    { "name": "no_incident_mttr", "passed": true, "detail": "No incidents → MTTR is null" },
    { "name": "goal_math", "passed": true, "detail": "Goal percentages correct within 0.1%" }
  ],
  "summary": "9/9 checks passed"
}
```

Each check is a real validation, not a stub. If any fails, `passed` is false.

#### GET /api/prs?from=&to=&repo=&page=1&limit=25
```json
{ "prs": [...], "total": 120, "page": 1, "pages": 5 }
```

#### GET /api/incidents?from=&to=&page=1&limit=25
```json
{ "incidents": [...], "total": 7, "page": 1, "pages": 1 }
```

### WRITE Endpoints

#### POST /api/refresh
Shell out to `fetch-github.py` and `fetch-jira.py`, reload data, recompute metrics. Return `{ "status": "ok", "prs": N, "incidents": M, "rate_limit_remaining": R }`.

#### PUT /api/goals
Accept a JSON body matching the `config/goals.json` schema. Validate that all values are positive numbers. Write to `config/goals.json` and reload in memory. Return `{ "status": "ok" }`.

## UI Design

### Creative Brief

**Inspiration:** Linear, GitHub Insights, Datadog, Grafana — data-dense dashboards that present complex metrics clearly.

**Goal:** This should feel like a real engineering metrics product. Clean, data-forward, professional. Not a toy dashboard.

**Color system:** Use the DORA rating colors (green/blue/amber/red) as the primary semantic palette. Background should be dark or neutral.

**Typography:** Choose a font that handles both headings and dense tabular data well. Use `font-feature-settings: 'tnum'` for all numeric displays.

**Charts:** Chart.js with customized tooltips, gridlines, and colors matching the design system.

**Responsive:** Must work at 1920px, 1280px, 768px, and 480px.

### Client-Side Routing

| Route | Page |
|-------|------|
| `#/overview` | Overview (default) |
| `#/cycle-time` | Cycle Time |
| `#/deploys` | Deploys |
| `#/reliability` | Reliability |
| `#/pr-deep-dive` | PR Deep Dive |
| `#/goals` | Goals & Targets |
| `#/reports` | Advanced Reporting |

- `/` or `#/` or empty → redirect to `#/overview`
- `hashchange` event for navigation
- Browser back/forward must work

### Required Components

1. **Sidebar navigation** — functional nav items for Overview, Cycle Time, Deploys, Reliability, PR Deep Dive, Goals, Advanced Reporting. Active state based on current hash.

2. **Header** — dynamic page title, time range picker, last refresh timestamp, refresh button.

3. **DORA metric cards** — reusable component. Shows: metric name, value (with unit), DORA rating badge, sparkline trend.

4. **Toast notifications** — for refresh and goal save feedback. Non-blocking, auto-dismiss 3s.

5. **Loading states** — skeleton loaders while data loads.

## File Boundaries (CRITICAL)

| File | Responsibility | Must NOT contain |
|------|---------------|------------------|
| `fetch-github.py` | GitHub API calls, pagination, PR/commit/review data extraction | DORA computation, UI code, Jira calls |
| `fetch-jira.py` | Jira API calls, pagination, incident data extraction, custom field discovery | DORA computation, UI code, GitHub calls |
| `server.js` | Load cached data + config, compute DORA metrics, serve API + static | HTML/CSS, API calls to GitHub/Jira |
| `public/*` | All UI: HTML, CSS, JS fetch/render (multi-file OK) | Node.js code, file system access |
| `config/repos.json` | Org config, Jira config, repo exclusions | Code |
| `config/teams.json` | Team definitions and bot config | Code |
| `config/goals.json` | DORA target values | Code |

## Error Handling Pattern

- **fetch-github.py / fetch-jira.py:** Print errors to stderr with `flush=True`. Save partial results if any pages succeeded. Exit non-zero on total failure. Handle rate limiting gracefully (log remaining, sleep if needed).
- **server.js:** Return `{ "error": "message" }` with appropriate HTTP status. Never crash on bad/missing data — return empty results with a warning. If data files don't exist, return error suggesting to run the fetchers.
- **Frontend:** Show user-friendly error messages. Retry failed fetches once. Show "No data" states gracefully.

## Behavioral Clarifications (IMPORTANT)

These resolve ambiguities that would otherwise lead to dead UI or broken features.

### Time Range Picker — State Persistence
Time range state lives in **JavaScript module-level variables** (not localStorage, not URL params). It resets on page reload. Every page reads from this state when making API calls. If no range is selected, omit `from`/`to` (backend defaults to last 90 days).

### Sparklines — Scope
Sparklines show **8 data points representing the 8 most recent complete weeks within the selected date range**. If the range is shorter than 8 weeks, show fewer points.

### Refresh Data Button — Loading Behavior
When clicked: (1) disable button, show spinner, (2) toast "Refreshing data...", (3) on success, toast "Data refreshed: N PRs, M incidents" and reload current page, (4) on failure, error toast, (5) re-enable button. User can navigate during refresh.

### Goal Editing — Save Behavior
**Explicit save**: input fields for each metric plus a "Save" button. Calls `PUT /api/goals`. Toast on success. Inline validation errors for non-positive numbers. No auto-save.

### Goal Progress Gauges — Amber Threshold
Green = meeting goal (pct_of_target ≤ 100% for lower-is-better, ≥ 100% for higher-is-better). Amber = within 20%. Red = missing by >20%.

### Incident Timeline — Bubble Chart
Chart.js **bubble** type. X = date, Y = repo (categorical), radius proportional to MTTR (5px min, 25px max).

### Deploy Heatmap — Rendering
**Custom HTML table or canvas grid.** Sequential color scale (light gray → dark blue). Color legend. NOT a Chart.js chart type.

### Calendar Heatmap — Rendering
**Custom SVG or canvas.** Each day = 12×12px square with 2px gap. Color: no deploys = light gray, 1 = light green, 2-3 = medium green, 4+ = dark green. Month labels above.

### PR Gantt Chart — Rendering
**Custom canvas** (not Chart.js). Each PR = horizontal bar from `first_commit_at` to `merged_at` with colored phase segments: Coding (blue), Pickup (orange), Review (purple), Deploy (green). Sorted by merge date. Tooltip on hover. 25 PRs per page with pagination.

### Cumulative Flow — Review Definition
`in_review` = PRs with `first_review_at` not null AND `merged_at` null at end of that week.

### Weekly Digest — Print
**"Print" button** triggers `window.print()`. `@media print` CSS hides sidebar/header, shows only digest card at full width.

### Digest Achievements/Concerns — Algorithm
**Achievements** (top 3 by magnitude): metric improved DORA tier, best value this quarter, >15% week-over-week improvement.
**Concerns** (top 3 by magnitude): metric dropped DORA tier, >15% week-over-week regression, CFR exceeded 15%.
Plain English sentences. Empty array if none.

### DORA Radar — Single Polygon with Comparison
Single polygon for current period. Second dashed-outline polygon for previous period comparison.

### MTTR Fallback
When custom fields are null: discovered = `created`, resolved = `resolutiondate`. Do NOT query changelog. If `resolutiondate` is null, exclude from MTTR.
