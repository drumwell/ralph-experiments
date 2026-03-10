# Design: Dynamic Repos & Team-Scoped DORA Metrics

## Phasing

- **Phase 1 (this spec):** Dynamic repo discovery + team configuration + team-filtered metrics
- **Phase 2 (separate spec):** Google OAuth with domain restriction, admin/member roles

## Architecture Note

This spec intentionally modifies the `config/repos.json` schema, which was marked FROZEN in `specs/ARCHITECTURE.md`. The FROZEN designation was a guardrail for the autonomous builder loop — this change is a product owner decision. `specs/ARCHITECTURE.md` must be updated as part of implementation to reflect the new schema, new config file, new endpoint, and updated file boundaries.

## 1. Dynamic Repo Discovery

### Current behavior
`fetch-github.py` reads a hardcoded list of 30 repos from `config/repos.json` and fetches merged PRs from each.

### New behavior
`fetch-github.py` calls `GET /orgs/paywithextend/repos?type=sources&per_page=100` (paginated) to discover all repos in the org. Archived repos (`archived: true`) are excluded. An optional `exclude_repos` list in config allows manually skipping specific repos.

### Config change

`config/repos.json` drops the `github_repos` array:

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

The fetcher discovers repos dynamically on each run. New repos are picked up automatically on the next fetch.

If `exclude_repos` contains a repo name that doesn't exist in the org, it is silently ignored.

### Scheduled refresh

A cron job runs the fetchers daily:

```
0 6 * * * cd /path/to/linearb && .venv/bin/python3 fetch-github.py && .venv/bin/python3 fetch-jira.py
```

The existing manual "Refresh Data" button in the UI remains for on-demand refresh. The server runs on port 3201.

## 2. Team Configuration

### New file: `config/teams.json`

```json
{
  "teams": {
    "Octopod": ["bjunya-extend", "ryan-mok", "donovan-yohan", "seanAtExtend", "kimispencer", "TylerMcCraw", "andrewclements"],
    "DCF4": ["byjoh", "sawarwick", "SimonOfAllTrades", "annnnna2", "meldiano1987"],
    "Core": ["Claiborne", "TalyatG", "anandyandawang", "milesbp", "clynch813"],
    "Platform": ["comjf", "BrianWW", "Justin1002"],
    "Managers": ["mtyeh411", "KristenManning", "drumwell"],
    "Other": ["dmorrow", "gangwarp08", "KevinExtend", "Matthiasexe"]
  },
  "exclude_bots": true
}
```

### Team assignment rules

- Every human contributor must be assigned to exactly one team.
- When `exclude_bots` is true, accounts are identified as bots if: (a) username ends with `[bot]`, or (b) username is in a `known_bots` list in `config/teams.json` (default: `["extend-buildbot", "extend-github-bot", "Copilot", "dependabot", "renovate"]`). Matching is case-insensitive.
- The `/api/sanity` endpoint flags any PR author in the current date range who is not assigned to a team and is not a bot. This surfaces as a failing sanity check (e.g., `"unassigned_contributors": ["newperson"]`). Scoped to the active date range so departed contributors don't permanently fail the check.

### How team filtering works

A PR is attributed to the team of its author. When a team filter is active, only PRs by members of that team are included in metric computation.

**Team filtering applies to PR-derived metrics only:**
- **Cycle Time** — filtered to team's PRs
- **Deployment Frequency** — filtered to team's PRs (merges)

**Incident-derived metrics are always org-wide:**
- **CFR** — always uses org-wide incident count / org-wide deploy count, regardless of team filter
- **MTTR** — always uses org-wide incident data, regardless of team filter

This avoids producing misleading CFR numbers (e.g., dividing org-wide incidents by a small team's deploy count). Incidents in Jira are not attributed to teams.

### Config loading

`server.js` loads `config/teams.json` on startup and reloads it when `/api/refresh` is called (same pattern as `config/goals.json`). Adding a new team member requires either a server restart or clicking "Refresh Data."

### Missing config fallback

If `config/teams.json` does not exist or is malformed, `GET /api/teams` returns `{ "teams": [], "members": {}, "error": "teams.json not found or invalid" }`. Team filtering is unavailable and the dropdown is hidden. All other endpoints behave as today (org-wide only).

## 3. API Changes

### New endpoint

#### GET /api/teams
```json
{
  "teams": ["Octopod", "DCF4", "Core", "Platform", "Managers", "Other"],
  "members": {
    "Octopod": ["bjunya-extend", "ryan-mok", "..."],
    "...": ["..."]
  }
}
```

### Modified endpoints

All existing READ endpoints gain an optional `team` query parameter:

- `GET /api/overview?team=Core&from=&to=`
- `GET /api/cycle-time?team=Octopod&from=&to=`
- `GET /api/deploys?team=DCF4&from=&to=`
- `GET /api/reliability?team=Core&from=&to=`
- `GET /api/pr-deep-dive?team=Platform&from=&to=`
- `GET /api/goals/status?team=Core&from=&to=`
- `GET /api/reports/*?team=Core&from=&to=`
- `GET /api/prs?team=Core&from=&to=`
- `GET /api/sanity?from=&to=`

When `team` is omitted or empty, behavior is unchanged (org-wide). When present, PR data is filtered to that team's members before computing metrics. CFR and MTTR remain org-wide regardless.

`/api/incidents` does not accept `team` — incidents are org-wide.
`/api/sanity` does not accept `team` — it always validates the full dataset.

**Invalid team name:** If `?team=NonExistent` is passed, return a 400 error: `{ "error": "Unknown team: NonExistent" }`.

### Sanity check additions

The `/api/sanity` endpoint gains a new check:

```json
{ "name": "team_assignment_complete", "passed": false, "detail": "Unassigned contributors: newperson1, newperson2" }
```

This check passes when every non-bot PR author in the current date range is assigned to a team in `config/teams.json`.

## 4. Frontend Changes

### Team dropdown

A dropdown is added to the header, next to the existing time range picker. It is populated from `GET /api/teams` on page load. If teams config is missing, the dropdown is not rendered.

Options:
- "All Teams" (default, no filter)
- One entry per team name

Selecting a team stores it in module-level state (same pattern as time range — persists across page navigation, resets on reload). All API calls include the `?team=` param when a team is selected. This applies to all existing fetch calls throughout `app.js`, not just new ones.

### No new pages

No team comparison page. No side-by-side team ranking. The existing 7 pages all work with the team filter — that's the only change.

### Reliability page caveat

When a team filter is active, the Overview and Reliability pages show a note on CFR and MTTR cards: "Incident metrics are org-wide regardless of team filter." This avoids confusion about why incident numbers don't change when switching teams.

## 5. File Changes Summary

| File | Change |
|------|--------|
| `fetch-github.py` | Replace hardcoded repo list with org API discovery; filter archived repos; respect `exclude_repos` |
| `config/repos.json` | Remove `github_repos` array; add `exclude_repos` |
| `config/teams.json` | New file — team definitions and bot config |
| `server.js` | Load teams config on startup + refresh; add `GET /api/teams`; add `team` query param filtering to all PR-based READ endpoints; keep CFR/MTTR org-wide; add team sanity check; return 400 for invalid team names |
| `public/app.js` | Add team dropdown to header; persist team state; include `team` param in all API calls; show org-wide note on incident metrics when team filtered |
| `public/index.html` | Add team dropdown element in header |
| `public/styles.css` | Style team dropdown consistent with time range picker |
| `specs/ARCHITECTURE.md` | Update repos.json schema, add teams.json to config section, add `GET /api/teams` to API contract, update file boundaries table |

## 6. What This Does NOT Include

- Per-user authentication (Phase 2)
- Admin/member roles (Phase 2)
- Team-attributed incidents (would require Jira tagging)
- Team comparison views or rankings
- Per-developer metrics
- Team management UI (config file only)
