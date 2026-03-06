# Spec: DORA Metrics Dashboard (LinearB Replacement)

## Goal

Build an org-wide DORA metrics dashboard for Extend engineering. The dashboard connects to the GitHub API (PRs, merges, commits) and Jira Cloud API (incidents tagged `change_failure`) to compute the four DORA metrics — Cycle Time, Deployment Frequency, Change Failure Rate, and MTTR — across all configured repos and configurable time periods.

This replaces LinearB with a bespoke tool tailored to Extend's workflow: merge-to-main deploys, Jira-tracked incidents with custom "Incident Discovered Time" / "Incident Resolution Time" fields, and a config-driven list of repos to monitor.

## Non-Goals

- No user authentication — API tokens in environment variables
- No database — file-based JSON storage (cached API data)
- No build toolchain — no webpack, no TypeScript, no React
- No per-developer performance metrics — this is org-level, not individual ranking
- No per-team breakdowns (for now) — all metrics are aggregated across all repos
- No alerting or Slack integration
- No real-time streaming — batch fetch with manual or scheduled refresh
- No deployment pipeline integration beyond "merge to main = deploy"

## Hard Constraints

- **Multi-file frontend with client-side routing:** `public/` directory with separate HTML/JS/CSS files organized by feature. Hash-based routing. The builder decides the file structure — could be one file per page, shared component files, a common CSS file, etc. Whatever makes sense.
- **No build step:** the app must work by running `node server.js` and visiting `localhost:3001`
- **Port 3001:** to avoid collision with ralph-trends on 3000
- **Express on port 3001:** one `server.js` file handles API + static serving
- **Python data fetchers:** separate scripts for GitHub and Jira data, using standard libraries
- **Chart.js for charts:** loaded via CDN
- **Config-driven repos:** repo list lives in `config/repos.json`, not hardcoded
- **Real data only:** no mock data, all data comes from live GitHub and Jira APIs
- **Deterministic metrics:** same input data must always produce the same DORA results

## Data Sources

### GitHub (via REST API v3 or GraphQL v4)

- **Org:** `paywithextend`
- **Auth:** `GITHUB_TOKEN` env var (Personal Access Token with `repo` scope)
- **What we fetch:**
  - Merged PRs to default branch (main/master) — for Cycle Time and Deployment Frequency
  - PR commits — for Coding Time (first commit → PR created)
  - PR reviews — for Pickup Time (PR created → first review) and Review Time (first review → approved)
  - PR merge timestamp — for Deploy Time (approved → merged) and Deployment Frequency

### Jira Cloud (via REST API v3)

- **Instance:** `paywithextend.atlassian.net`
- **Auth:** `JIRA_EMAIL` + `JIRA_API_TOKEN` env vars (Basic Auth)
- **Project:** `EX`
- **What we fetch:**
  - Issues with label `change_failure` — for CFR and MTTR
  - Custom fields: "Incident Discovered Time" and "Incident Resolution Time" — for precise MTTR
  - Issue status and resolution dates — for fallback MTTR if custom fields are empty

## Repos

30 repos defined in `config/repos.json`. The fetcher pulls merged PRs from all of them.

## DORA Metrics Definitions

### 1. Cycle Time

**Definition:** Time from first commit on a feature branch to PR merged to the default branch.

**Sub-phases:**
| Phase | Start Event | End Event |
|-------|-------------|-----------|
| Coding Time | First commit on branch (authored timestamp) | PR opened (created_at) |
| Pickup Time | PR opened (created_at) | First review submitted |
| Review Time | First review submitted | PR approved (last approval before merge) |
| Deploy Time | PR approved | PR merged (merged_at) |

**Total Cycle Time** = Coding + Pickup + Review + Deploy

**Rules:**
- Only count merged PRs to the default branch
- If a PR has no reviews, Pickup = 0 and Review = 0 (auto-merged)
- If a PR has commits after opening, those don't extend Coding Time
- Negative phases (e.g., commit after PR opened) are clamped to 0
- Time is measured in hours, displayed as hours or days depending on magnitude

### 2. Deployment Frequency

**Definition:** Number of merges to the default branch per time period.

**Calculation:**
- Count merged PRs to default branch, grouped by merge date
- Express as: deploys per day, per week, or per month (depending on time range)

**DORA benchmark mapping:**
| Rating | Threshold |
|--------|-----------|
| Elite | Multiple per day (> 1/day average) |
| High | Between daily and weekly |
| Medium | Between weekly and monthly |
| Low | Less than monthly |

### 3. Change Failure Rate (CFR)

**Definition:** Percentage of deployments that result in a production incident.

**Calculation:**
```
CFR = (count of change_failure incidents in period) / (count of merges to main in period) × 100
```

**Incident identification:** Jira issues in project `EX` with label `change_failure`.

**Time matching:** Incidents are attributed to the period in which they were created (not when the causing deploy happened).

**DORA benchmark mapping:**
| Rating | Threshold |
|--------|-----------|
| Elite | 0–5% |
| High | 5–10% |
| Medium | 10–15% |
| Low | 16%+ |

### 4. Mean Time to Restore (MTTR)

**Definition:** Average time from incident discovery to resolution.

**Calculation:**
```
MTTR = avg(Incident Resolution Time - Incident Discovered Time)
```

**Primary source:** Custom Jira fields "Incident Discovered Time" and "Incident Resolution Time" (datetime fields).

**Fallback:** If custom fields are empty, use `created` → `resolutiondate` field.

**DORA benchmark mapping:**
| Rating | Threshold |
|--------|-----------|
| Elite | Less than 1 hour |
| High | Less than 1 day |
| Medium | 1 day to 1 week |
| Low | More than 1 week |

## Pages

### 1. Overview (`#/overview` — default)
Executive summary across the org.

- 4 DORA metric cards: Cycle Time (median, hours), Deployment Frequency (deploys/week), CFR (%), MTTR (median, hours)
- Each card shows the DORA rating badge (Elite/High/Medium/Low) with color coding
- Trend sparklines on each card (last 8 weeks)
- Deployment frequency bar chart (deploys per week over time)
- Recent incidents list (last 5 `change_failure` issues with status, priority, MTTR)
- Recent deploys feed (last 10 merges with repo, author, time)

### 2. Cycle Time (`#/cycle-time`)
Cycle time analysis across all repos.

- Cycle time trend chart: weekly medians over time (line chart)
- Phase breakdown: stacked area chart showing how time is distributed across Coding/Pickup/Review/Deploy
- Slowest PRs table: top 10 longest cycle time PRs
- Phase comparison: which phase is the biggest bottleneck (horizontal stacked bar, one bar per week)
- Distribution histogram: how cycle times are distributed (buckets)

### 3. Deploys (`#/deploys`)
Deployment frequency analysis.

- Deploy frequency trend: weekly deploy counts over time (bar chart)
- Deploy heatmap: day-of-week × hour-of-day heatmap for deploy timing (custom HTML table or canvas grid, NOT a Chart.js chart type)
- Repo breakdown table: deploys per repo, sortable
- Deploy size: average PR size (files changed, lines changed) over time

### 4. Reliability (`#/reliability`)
CFR and MTTR together — the reliability picture.

- CFR trend: rolling 4-week CFR over time (line chart)
- MTTR trend: rolling 4-week median MTTR over time (line chart)
- Incident timeline: bubble chart (Chart.js bubble type) of incidents by date (X) and repo (Y), bubble radius proportional to MTTR
- Incident detail table: all `change_failure` issues with priority, MTTR, link to Jira
- CFR vs deploy volume: dual-axis chart showing whether higher deploy frequency correlates with more failures

### 5. PR Deep Dive (`#/pr-deep-dive`)
Individual PR-level analysis with timeline visualization.

- **PR timeline / Gantt chart:** Each PR rendered as a horizontal bar spanning first_commit_at → merged_at, with colored segments for each phase (Coding=blue, Pickup=orange, Review=purple, Deploy=green). Bars stacked vertically by merge date, most recent at top. This is a custom canvas-based visualization, not a standard bar chart.
- **PR search and filter:** Text search by title/author, filter by repo, sort by total cycle time / merge date / PR size
- **PR detail expansion:** Click a PR row to expand an inline detail panel showing: full phase timing breakdown, commit count, files changed, additions/deletions, review count, link to GitHub PR
- **Outlier detection:** Automatically flag PRs with cycle time > 2× the org median. Highlight them visually (e.g., red border or warning icon). Show a summary count: "X outlier PRs detected"
- **PR size vs cycle time scatter:** Each PR as a dot, X=files changed, Y=total cycle time hours, colored by repo. Shows whether larger PRs take proportionally longer.

### 6. Goals & Targets (`#/goals`)
Org-wide DORA target tracking.

- **Target configuration panel:** Set target values for each of the 4 DORA metrics (e.g., "Cycle Time < 24h, Deploy Frequency > 1/day, CFR < 5%, MTTR < 2h"). Targets are stored in `config/goals.json` and served via API. Explicit save button — calls `PUT /api/goals`, shows toast on success, inline validation errors on failure.
- **Goal progress gauges:** 4 radial/arc gauges showing current value vs target. Green if meeting target, amber if within 20%, red if missing by >20%.
- **Goal trend over time:** Line chart showing each metric's actual value vs the target line over the last 8 weeks. Makes it clear whether the org is trending toward or away from goals.
- **Week-over-week delta cards:** For each metric, show the change from last week: "Cycle Time: 18.5h → 16.2h (↓ 12.4%)" with green/red arrows indicating improvement or regression.

### 7. Advanced Reporting (`#/reports`)
Complex visualizations and deeper analytics.

- **Calendar heatmap:** GitHub-style contribution calendar showing deploy density per day across the entire date range. Each day is a small square, colored by deploy count (light → dark). This must be a custom canvas/SVG rendering — not a standard Chart.js chart type.
- **Cumulative flow diagram:** Stacked area chart showing cumulative PR counts over time by phase status (coding, in review, merged). Reveals bottlenecks where work piles up in a particular phase.
- **Throughput vs WIP chart:** Dual-axis chart. Left axis: throughput (PRs merged per week). Right axis: work-in-progress (open PRs at end of week). Shows the relationship between WIP and delivery rate.
- **Incident correlation analysis:** For each incident, find the most likely causing deploy (closest merge to main before incident discovery). Show a linked table: incident → suspected causing PR → author → time between deploy and incident.
- **DORA maturity radar chart:** Radar/spider chart with 4 axes (one per DORA metric), normalized to 0-100 scale where 100 = Elite threshold.
- **Weekly digest view:** A summary card for the selected time period with a "Print" button (triggers `window.print()` with `@media print` CSS that isolates the digest). Shows all 4 metrics with week-over-week deltas, top 3 achievements (e.g., "Fastest cycle time this quarter"), top 3 concerns (e.g., "CFR increased 40% week-over-week"), and the overall DORA rating. See ARCHITECTURE.md "Behavioral Clarifications" for the achievement/concern generation algorithm.

## Cross-Cutting Features

### Time Range Picker
- Preset buttons: 30d, 90d, 6mo, 1yr, All
- Custom date range inputs
- Persists across page navigation (JS module-level state, resets on page reload)
- All API calls include `from`/`to` when a range is active

### DORA Rating Badges
- Color-coded badges: Elite (green), High (blue), Medium (yellow), Low (red)
- Applied to each metric card based on the benchmark thresholds
- Consistent across all pages

### Data Refresh
- Manual "Refresh Data" button re-fetches from GitHub and Jira APIs
- Disable button and show spinner during refresh, toast on completion or error
- Last refresh timestamp shown in header
- Refresh is rate-limit-aware (shows warning if near GitHub rate limit)

### Keyboard Shortcuts
- `g o` → Overview, `g c` → Cycle Time, `g d` → Deploys, `g r` → Reliability, `g p` → PR Deep Dive, `g g` → Goals, `g a` → Advanced Reporting
- `?` → shortcut help overlay

## Deliverables

When finished, these files must exist and work:

```
fetch-github.py          # Fetches merged PRs, commits, reviews from GitHub API
fetch-jira.py            # Fetches change_failure incidents from Jira API
server.js                # Express server: loads cached data, computes DORA metrics, serves API + static
public/                  # Frontend files (HTML/JS/CSS) — builder decides structure
config/repos.json        # Repo list and Jira config
config/goals.json        # DORA target values
data/github_prs.json     # Cached GitHub PR data
data/jira_incidents.json # Cached Jira incident data
package.json             # Node dependencies (express only)
```

## Done When

All of the following are true:

**Data & API:**
- [ ] `fetch-github.py` retrieves merged PRs from all 30 configured repos for the last 90 days
- [ ] `fetch-jira.py` retrieves `change_failure` issues from Jira project EX
- [ ] Both fetchers handle pagination and rate limiting gracefully
- [ ] All READ endpoints return valid JSON with correct DORA calculations
- [ ] Date range params (`from`, `to`) work on all endpoints
- [ ] Metrics are deterministic (same data → same results)

**Pages & Routing:**
- [ ] Hash routing works: `#/overview`, `#/cycle-time`, `#/deploys`, `#/reliability`, `#/pr-deep-dive`, `#/goals`, `#/reports`
- [ ] Default route redirects to `#/overview`
- [ ] Sidebar navigation works with active state
- [ ] Browser back/forward works
- [ ] Each page loads its own data and renders correctly

**Overview Page:**
- [ ] 4 DORA metric cards with values, ratings, and sparklines
- [ ] Deployment frequency bar chart
- [ ] Recent incidents and deploys lists

**Cycle Time Page:**
- [ ] Cycle time trend (weekly medians)
- [ ] Phase breakdown visualization
- [ ] Slowest PRs table
- [ ] Distribution histogram

**Deploys Page:**
- [ ] Deploy frequency trend
- [ ] Deploy heatmap (custom rendering, not Chart.js)
- [ ] Repo breakdown table

**Reliability Page:**
- [ ] CFR and MTTR trends
- [ ] Incident timeline bubble chart
- [ ] Incident detail table
- [ ] CFR vs deploy volume chart

**PR Deep Dive Page:**
- [ ] PR timeline / Gantt chart with phase-colored segments (custom canvas rendering)
- [ ] PR search and filter (text, repo, sort)
- [ ] PR detail expansion on click
- [ ] Outlier detection with visual flagging
- [ ] PR size vs cycle time scatter

**Goals & Targets Page:**
- [ ] Target configuration with explicit save (PUT /api/goals round-trip works)
- [ ] Goal progress gauges (radial/arc) with green/amber/red color coding
- [ ] Goal trend over time (actual vs target line charts)
- [ ] Week-over-week delta cards with directional arrows

**Advanced Reporting Page:**
- [ ] Calendar heatmap (GitHub-style deploy density per day, custom rendering)
- [ ] Cumulative flow diagram (stacked area by phase status)
- [ ] Throughput vs WIP dual-axis chart
- [ ] Incident correlation analysis (incident → suspected causing PR)
- [ ] DORA maturity radar chart (normalized 0-100)
- [ ] Weekly digest view with Print button (window.print with @media print CSS)

**Metric Sanity Checks:**
- [ ] Cycle time phases sum to total (no off-by-one or rounding drift)
- [ ] Deployment count matches between overview and deploys page
- [ ] CFR denominator (deploy count) is consistent across all views
- [ ] MTTR values are consistent between reliability page and overview
- [ ] Sparkline data points match the weekly aggregates in trend endpoints
- [ ] Date range filtering produces identical metric values regardless of which endpoint is queried
- [ ] Zero-deploy periods show CFR as 0%, not NaN or undefined
- [ ] No-incident periods show MTTR as null/N/A, not 0
- [ ] Goal progress percentages are mathematically correct against config/goals.json targets
- [ ] Sanity check endpoint (`GET /api/sanity`) validates all of the above and returns pass/fail per check

**Cross-Cutting:**
- [ ] Time range picker works and persists across pages
- [ ] DORA rating badges render correctly on all metric cards
- [ ] Data refresh button works (disables during refresh, toasts on completion)
- [ ] Keyboard shortcuts work
- [ ] No dead buttons: every cursor:pointer has a handler

**Polish:**
- [ ] Responsive layout (collapses gracefully)
- [ ] Loading states for charts and tables
- [ ] Error states for failed fetches
- [ ] Toast notifications for actions

Output `<promise>COMPLETE</promise>` only when every checkbox above is verified.
