# Teams & Dynamic Repos Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic org-wide repo discovery and team-scoped DORA metrics filtering to the dashboard.

**Architecture:** `fetch-github.py` discovers repos from the GitHub org API instead of a hardcoded list. A new `config/teams.json` maps GitHub usernames to teams. `server.js` gains a `?team=` query param on all PR-based endpoints that filters PRs by author team membership. The frontend adds a team dropdown in the header that persists across pages.

**Tech Stack:** Python 3 (urllib), Node.js/Express, vanilla JS frontend, Chart.js

**Spec:** `docs/superpowers/specs/2026-03-10-teams-and-repos-design.md`

---

## Chunk 1: Dynamic Repo Discovery

### Task 1: Update fetch-github.py to discover repos from org API

**Files:**
- Modify: `fetch-github.py:220-254` (the `main()` function)
- Modify: `config/repos.json`

- [ ] **Step 1: Update `config/repos.json` — remove `github_repos`, add `exclude_repos`**

Replace the entire file with:

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

- [ ] **Step 2: Add `fetch_org_repos()` function to `fetch-github.py`**

Add this function before `main()` (around line 218):

```python
def fetch_org_repos(org, exclude_repos=None):
    """Discover all non-archived repos in the org via the GitHub API."""
    exclude = set(exclude_repos or [])
    url = f"{BASE_URL}/orgs/{org}/repos?type=sources&per_page=100"
    repos = []
    for repo_data in get_paginated(url):
        name = repo_data.get("name", "")
        if repo_data.get("archived", False):
            continue
        if name in exclude:
            continue
        repos.append(name)
    repos.sort()
    return repos
```

- [ ] **Step 3: Update `main()` to use dynamic discovery**

Replace the entire `main()` function (lines 220-251):

```python
def main():
    config_path = os.path.join(os.path.dirname(__file__), "config", "repos.json")
    with open(config_path) as f:
        config = json.load(f)

    org = config["github_org"]
    exclude_repos = config.get("exclude_repos", [])

    print(f"Discovering repos in {org}...", flush=True)
    repos = fetch_org_repos(org, exclude_repos)
    print(f"Found {len(repos)} active repos (excluding {len(exclude_repos)} excluded, archived repos filtered)", flush=True)

    print(f"Fetching merged PRs (last {LOOKBACK_DAYS} days)...", flush=True)
    print(f"Cutoff: {CUTOFF}", flush=True)

    all_prs = []

    for i, repo in enumerate(repos, 1):
        print(f"[{i}/{len(repos)}] {org}/{repo}...", end=" ", flush=True)
        try:
            prs = fetch_repo_prs(org, repo)
            all_prs.extend(prs)
            print(f"{len(prs)} PRs", flush=True)
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr, flush=True)

    # Sort by merged_at descending
    all_prs.sort(key=lambda p: p["merged_at"], reverse=True)

    out_path = os.path.join(os.path.dirname(__file__), "data", "github_prs.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(all_prs, f, indent=2)

    print(f"\nDone. {len(all_prs)} total PRs written to {out_path}", flush=True)
```

- [ ] **Step 4: Update `server.js` to not depend on `github_repos` from config**

In `server.js`, the `repos` variable loaded from `config/repos.json` is used in the sanity endpoint and potentially elsewhere. Search for any usage of `repos.github_repos` and remove/update it. The `repos` object is still loaded for `github_org`, `jira_instance`, etc. — just no longer has a `github_repos` array.

In `server.js:46-52`, no change needed — it loads the full config object. But verify no endpoint references `repos.github_repos`. Run:

```bash
grep -n "github_repos" server.js
```

Expected: no matches (if there are matches, update them to derive the repo list from the PR data instead: `[...new Set(prs.map(p => p.repo))].sort()`).

- [ ] **Step 5: Verify fetch-github.py runs**

```bash
.venv/bin/python3 fetch-github.py 2>&1 | head -20
```

Expected: "Discovering repos in paywithextend... Found N active repos..." followed by per-repo fetch output.

Note: This will make real GitHub API calls. If you want to verify the org discovery without fetching all PRs, add a `--discover-only` flag or just check the first few lines of output.

- [ ] **Step 6: Commit**

```bash
git add fetch-github.py config/repos.json
git commit -m "feat: dynamic repo discovery from GitHub org API"
```

---

## Chunk 2: Team Configuration in Server

### Task 2: Load teams config in server.js

**Files:**
- Modify: `server.js:16-62` (data loading section)

- [ ] **Step 1: Add `teams` to the module-level state**

In `server.js`, after line 20 (`let goals = {};`), add:

```javascript
let teams = {};
```

- [ ] **Step 2: Add teams loading to `loadData()`**

In `server.js`, inside `loadData()`, after the goals loading block (after line 61), add:

```javascript
  // config/teams.json
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config', 'teams.json'), 'utf8');
    teams = JSON.parse(raw);
    const teamCount = Object.keys(teams.teams || {}).length;
    const memberCount = Object.values(teams.teams || {}).reduce((s, m) => s + m.length, 0);
    console.log(`Loaded ${teamCount} teams (${memberCount} members) from config/teams.json`);
  } catch (e) {
    console.error('WARNING: Could not load config/teams.json —', e.message);
    teams = {};
  }
```

- [ ] **Step 3: Add bot detection helper**

After the `computeMTTR` function (after line 260, before the `// ─── API Endpoints` comment at line 262), add:

```javascript
/**
 * Returns true if the given username is a bot account.
 * Checks: ends with [bot], or is in known_bots list (case-insensitive).
 */
function isBot(username) {
  if (!username) return false;
  if (username.endsWith('[bot]')) return true;
  const knownBots = (teams.known_bots || ['extend-buildbot', 'extend-github-bot', 'Copilot', 'dependabot', 'renovate'])
    .map(b => b.toLowerCase());
  return knownBots.includes(username.toLowerCase());
}

/**
 * Returns the team name for a given GitHub username, or null if unassigned.
 */
function getTeam(username) {
  if (!teams.teams) return null;
  for (const [teamName, members] of Object.entries(teams.teams)) {
    if (members.includes(username)) return teamName;
  }
  return null;
}

/**
 * Filter PRs by team. If teamName is falsy, returns all PRs.
 * If teamName is provided but not found in config, returns null (invalid team).
 */
function filterByTeam(prList, teamName) {
  if (!teamName) return prList;
  if (!teams.teams || !teams.teams[teamName]) return null;
  const members = new Set(teams.teams[teamName]);
  return prList.filter(pr => members.has(pr.author));
}
```

- [ ] **Step 4: Add `GET /api/teams` endpoint**

Before the `/api/overview` endpoint (around line 264), add:

```javascript
// GET /api/teams
app.get('/api/teams', (req, res) => {
  if (!teams.teams || Object.keys(teams.teams).length === 0) {
    return res.json({ teams: [], members: {}, error: 'teams.json not found or invalid' });
  }
  res.json({
    teams: Object.keys(teams.teams),
    members: teams.teams,
  });
});
```

- [ ] **Step 5: Add `known_bots` to `config/teams.json`**

Update `config/teams.json` to include the known bots list:

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
  "known_bots": ["extend-buildbot", "extend-github-bot", "Copilot", "dependabot", "renovate"],
  "exclude_bots": true
}
```

- [ ] **Step 6: Verify server starts and /api/teams works**

```bash
node server.js &
sleep 2
curl -s http://localhost:3201/api/teams | python3 -m json.tool
kill %1
```

Expected: JSON with `teams` array and `members` object.

- [ ] **Step 7: Commit**

```bash
git add server.js config/teams.json
git commit -m "feat: load teams config, add GET /api/teams endpoint"
```

---

### Task 3: Add team filtering to all PR-based API endpoints

**Files:**
- Modify: `server.js:265-1200` (all GET endpoints)

The pattern for every PR-based endpoint: after `filterByDateRange(prs, 'merged_at', ...)`, call `applyTeamFilter()` and use `teamPRs` instead of `filteredPRs` for PR-derived computations. CFR and MTTR always use org-wide data (`filteredPRs` and `filteredIncidents`).

**IMPORTANT:** Do NOT add team filtering to `/api/sanity` (Task 4 handles that separately) or `/api/incidents` (incidents are org-wide).

- [ ] **Step 1: Add team validation helper at the top of the endpoints section**

After the `/api/teams` endpoint, add a reusable helper:

```javascript
/**
 * Extract and validate team param from request query.
 * Returns { teamPRs, teamName, error }.
 * If error is set, the caller should return 400.
 */
function applyTeamFilter(filteredPRs, query) {
  const teamName = query.team || '';
  if (!teamName) return { teamPRs: filteredPRs, teamName: '' };

  const result = filterByTeam(filteredPRs, teamName);
  if (result === null) {
    return { teamPRs: null, teamName, error: `Unknown team: ${teamName}` };
  }
  return { teamPRs: result, teamName };
}
```

- [ ] **Step 2: Add team filtering to `GET /api/overview` (line 265)**

After line 270 (`const filteredPRs = filterByDateRange(prs, 'merged_at', ...)`), add the team filter:

```javascript
  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
```

Then make these specific changes in the overview handler:

| Line(s) | Current variable | Change to | Why |
|---------|-----------------|-----------|-----|
| ~274 (weeklyPRs grouping) | `filteredPRs` | `teamPRs` | Deploy trend scoped to team |
| ~278 (cycle time `ctHours`) | `filteredPRs` | `teamPRs` | CT scoped to team |
| ~282 (weekly CT loop) | uses `weeklyPRs` | already changed via weeklyPRs | - |
| ~288-289 (deployCount, deploysPerDay) | `filteredPRs.length` | `teamPRs.length` | Deploy freq scoped to team |
| ~291-293 (weeklyDeployCountMap) | uses `weeklyPRs` | already changed | - |
| ~296-298 (CFR: incidentCount, cfrPct) | `filteredPRs` for deploy count | **KEEP `filteredPRs`** | CFR stays org-wide |
| ~305-320 (MTTR) | `filteredIncidents` | **KEEP** | MTTR stays org-wide |
| ~340+ (deploy_trend) | uses `weeklyPRs` | already changed | - |
| ~350+ (recent_deploys) | `filteredPRs` | `teamPRs` | Scoped to team |
| ~345+ (recent_incidents) | `filteredIncidents` | **KEEP** | Org-wide |

- [ ] **Step 3: Add team filtering to `GET /api/cycle-time` (line 383)**

After the `filterByDateRange` call for PRs, add:

```javascript
  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
```

Replace ALL references to `filteredPRs` in this handler with `teamPRs`. This endpoint is entirely PR-based — no incident data, so every reference changes.

- [ ] **Step 4: Add team filtering to `GET /api/deploys` (line 443)**

Same pattern. After date range filter, add `applyTeamFilter`. Replace ALL `filteredPRs` with `teamPRs`. This endpoint is entirely PR-based.

- [ ] **Step 5: Add team filtering to `GET /api/reliability` (line 499)**

Add the `applyTeamFilter` call for consistency (so `?team=InvalidName` still returns 400), but do NOT use `teamPRs` for any computation. All data in this handler stays org-wide:

```javascript
  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
  // Note: all reliability data uses filteredPRs/filteredIncidents (org-wide)
  // teamPRs is intentionally unused — see spec
```

- [ ] **Step 6: Add team filtering to `GET /api/pr-deep-dive` (line 550)**

After date range filter, add `applyTeamFilter`. Replace all PR references with `teamPRs`. This includes the `allPRs` variable used for sorting/pagination and the outlier median computation.

- [ ] **Step 7: Add team filtering to `GET /api/prs` (line 630)**

After date range filter, add `applyTeamFilter`. Replace `filteredPRs` with `teamPRs`.

- [ ] **Step 8: Add team filtering to `GET /api/goals/status` (line 670)**

After date range filter, add `applyTeamFilter`. Use `teamPRs` for:
- Cycle Time median
- Deploy frequency (deploys per day)
- Weekly deltas for CT and deploy freq

Keep `filteredPRs`/`filteredIncidents` for:
- CFR computation
- MTTR computation
- Weekly deltas for CFR and MTTR

- [ ] **Step 9: Add team filtering to report endpoints**

For each of these, add `applyTeamFilter` after date range filtering:

- `GET /api/reports/calendar` (line 869): use `teamPRs` — deploy calendar scoped to team
- `GET /api/reports/flow` (line 887): use `teamPRs` — cumulative flow scoped to team
- `GET /api/reports/incident-correlation` (line 941): incidents stay org-wide (`filteredIncidents`), but use `teamPRs` for the suspected-causing-PR lookup (only match team's PRs)
- `GET /api/reports/radar` (line 992): CT and deploy freq axes use `teamPRs`; CFR and MTTR axes use `filteredPRs`/`filteredIncidents`
- `GET /api/reports/digest` (line 1046): same split as radar — CT/deploy freq from `teamPRs`, CFR/MTTR org-wide

- [ ] **Step 10: Verify team filtering works**

```bash
node server.js &
sleep 2
# Org-wide
curl -s "http://localhost:3201/api/overview" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Org: {d[\"metrics\"][\"deploy_frequency\"][\"total_deploys\"]} deploys')"
# Team-filtered
curl -s "http://localhost:3201/api/overview?team=Core" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Core: {d[\"metrics\"][\"deploy_frequency\"][\"total_deploys\"]} deploys')"
# Invalid team — should return 400
curl -s -w "\n%{http_code}" "http://localhost:3201/api/overview?team=FakeTeam"
# Reliability should be same org-wide regardless of team
curl -s "http://localhost:3201/api/reliability" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Org CFR: {d[\"cfr_trend\"][-1][\"pct\"] if d[\"cfr_trend\"] else \"N/A\"}')"
curl -s "http://localhost:3201/api/reliability?team=Core" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Core CFR: {d[\"cfr_trend\"][-1][\"pct\"] if d[\"cfr_trend\"] else \"N/A\"}')"
kill %1
```

Expected: Core deploys < Org deploys. Invalid team returns 400. Reliability CFR is identical for both queries.

- [ ] **Step 11: Commit**

```bash
git add server.js
git commit -m "feat: add team query param filtering to all API endpoints"
```

---

### Task 4: Add team assignment sanity check

**Files:**
- Modify: `server.js:1262-1404` (sanity endpoint)

- [ ] **Step 1: Add `team_assignment_complete` check to `/api/sanity`**

After the `goal_math` check (around line 1396), add:

```javascript
  // 10. team_assignment_complete: all non-bot PR authors are assigned to a team
  addCheck('team_assignment_complete', () => {
    if (!teams.teams || Object.keys(teams.teams).length === 0) {
      return { passed: true, detail: 'No teams configured — skipping' };
    }
    const allMembers = new Set(Object.values(teams.teams).flat());
    const excludeBots = teams.exclude_bots !== false;
    const unassigned = [];
    const authors = new Set(filteredPRs.map(pr => pr.author));
    for (const author of authors) {
      if (excludeBots && isBot(author)) continue;
      if (!allMembers.has(author)) unassigned.push(author);
    }
    return unassigned.length === 0
      ? { passed: true, detail: `All ${authors.size} contributors assigned to teams` }
      : { passed: false, detail: `Unassigned contributors: ${unassigned.join(', ')}` };
  });
```

- [ ] **Step 2: Update the summary count**

No change needed — the existing code at line 1398-1403 dynamically counts checks.

- [ ] **Step 3: Verify sanity check**

```bash
node server.js &
sleep 2
curl -s http://localhost:3201/api/sanity | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f'{c[\"name\"]}: {\"PASS\" if c[\"passed\"] else \"FAIL\"} — {c[\"detail\"]}') for c in d['checks']]"
kill %1
```

Expected: `team_assignment_complete` check appears. If there are PR authors not in `teams.json`, it will show FAIL with their names — update `config/teams.json` accordingly.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add team assignment sanity check"
```

---

## Chunk 3: Frontend Team Dropdown

### Task 5: Add team dropdown to HTML header

**Files:**
- Modify: `public/index.html:60-81` (header section)

- [ ] **Step 1: Add team dropdown element**

In `public/index.html`, after the time range picker `</div>` (line 74) and before the refresh button (line 76), add:

```html
      <select id="team-filter" class="filter-select" style="display:none">
        <option value="">All Teams</option>
      </select>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add team filter dropdown to header HTML"
```

---

### Task 6: Add team state and API integration in app.js

**Files:**
- Modify: `public/app.js:1-52` (state and utility section)
- Modify: `public/app.js:1226-1233` (init section)

- [ ] **Step 1: Add team state variable**

In `public/app.js`, after line 5 (`let timeRange = ...`), add:

```javascript
let selectedTeam = '';
```

- [ ] **Step 2: Update `getApiParams()` to include team**

In `public/app.js`, modify the `getApiParams()` function (lines 41-52). Add the team param after the date range logic, before the return. The full function becomes:

```javascript
function getApiParams() {
  const params = new URLSearchParams();
  if (timeRange.from) params.set('from', timeRange.from);
  if (timeRange.to) params.set('to', timeRange.to);
  if (!timeRange.from && timeRange.days !== 'all') {
    const to = new Date();
    const from = new Date(to - timeRange.days * 86400000);
    params.set('from', from.toISOString().slice(0, 10));
    params.set('to', to.toISOString().slice(0, 10));
  }
  if (selectedTeam) params.set('team', selectedTeam);
  return params.toString() ? `?${params}` : '';
}
```

Note: The PR Deep Dive page loader (around line 456) builds its own URLSearchParams via `getApiParams().replace('?', '')`. Since `getApiParams()` now includes the team param, this will work automatically — no additional change needed for PR Deep Dive.

- [ ] **Step 3: Add team dropdown initialization and event handler**

Add this block after the `// ── PR Deep Dive filters` section (after line 1175) and before the `// ── Keyboard shortcuts` section:

```javascript
// ── Team filter ───────────────────────────────────────────────────────────────

async function initTeamFilter() {
  const select = document.getElementById('team-filter');
  if (!select) return;
  try {
    const data = await apiFetch('/api/teams');
    if (!data.teams || data.teams.length === 0) {
      select.style.display = 'none';
      return;
    }
    // Populate options
    select.innerHTML = '<option value="">All Teams</option>';
    for (const team of data.teams) {
      const opt = document.createElement('option');
      opt.value = team;
      opt.textContent = team;
      select.appendChild(opt);
    }
    select.style.display = '';
    select.addEventListener('change', () => {
      selectedTeam = select.value;
      if (PAGE_LOADERS[currentRoute]) PAGE_LOADERS[currentRoute]();
    });
  } catch (e) {
    console.error('Failed to load teams:', e);
    select.style.display = 'none';
  }
}
```

Note: The change handler uses `PAGE_LOADERS[currentRoute]()` — this is the existing pattern used by the time range picker (line 1124) and refresh button (line 1153). There is no `loadCurrentPage()` function in this codebase.

- [ ] **Step 4: Call `initTeamFilter()` on page load**

In the `// ── Init` section at the bottom of `app.js` (line 1226), add the `initTeamFilter()` call. The init section currently looks like:

```javascript
// ── Init ──────────────────────────────────────────────────────────────────────

// Default route
if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
  window.location.hash = '#/overview';
} else {
  handleHashChange();
}
```

Change it to:

```javascript
// ── Init ──────────────────────────────────────────────────────────────────────

// Load team dropdown (async, doesn't block page load)
initTeamFilter();

// Default route
if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
  window.location.hash = '#/overview';
} else {
  handleHashChange();
}
```

`initTeamFilter()` is async and runs in the background — it populates the dropdown after the page loads. The initial page load fires immediately via `handleHashChange()` with `selectedTeam = ''` (org-wide), which is correct. Once the dropdown is populated, the user can select a team and it will re-fetch.

- [ ] **Step 5: Verify the dropdown appears and filters data**

```bash
node server.js &
sleep 2
```

Open `http://localhost:3201` in browser. Verify:
- Team dropdown appears in the header after a brief moment
- Selecting "Core" reloads the page data with fewer deploys
- Selecting "All Teams" returns to org-wide view
- Switching pages preserves the team selection
- The time range picker still works alongside the team filter

```bash
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: team dropdown with state persistence and API integration"
```

---

### Task 7: Style the team dropdown

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Verify existing `.filter-select` styles**

The team dropdown uses `class="filter-select"` which already exists in the codebase (used by the PR Deep Dive filters). Check that it looks appropriate in the header context. If it needs adjustments for the header placement, add:

```css
.header .filter-select {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.75rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "feat: style team dropdown in header"
```

---

### Task 8: Add org-wide incident note on filtered views

**Files:**
- Modify: `public/app.js` (overview and reliability page loaders)

- [ ] **Step 1: Add incident caveat note to overview page**

In the overview page loader function, after rendering the metric cards, add a conditional note when a team is selected. Find where the overview cards are rendered and add after them:

```javascript
    // Show org-wide caveat for incident metrics when team-filtered
    const existingNote = document.getElementById('team-incident-note-overview');
    if (existingNote) existingNote.remove();
    if (selectedTeam) {
      const note = document.createElement('div');
      note.id = 'team-incident-note-overview';
      note.className = 'team-caveat';
      note.textContent = 'CFR and MTTR are org-wide metrics — not filtered by team.';
      document.getElementById('overview-cards').after(note);
    }
```

- [ ] **Step 2: Add incident caveat note to reliability page**

Same pattern in the reliability page loader:

```javascript
    const existingNote = document.getElementById('team-incident-note-reliability');
    if (existingNote) existingNote.remove();
    if (selectedTeam) {
      const note = document.createElement('div');
      note.id = 'team-incident-note-reliability';
      note.className = 'team-caveat';
      note.textContent = 'Incident data is org-wide regardless of team filter.';
      const page = document.getElementById('page-reliability');
      page.insertBefore(note, page.firstChild);
    }
```

- [ ] **Step 3: Add caveat styling**

In `public/styles.css`, add:

```css
.team-caveat {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #f59e0b;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.75rem;
  margin-bottom: 12px;
}
```

- [ ] **Step 4: Verify caveat appears**

Open the dashboard, select a team, navigate to Overview and Reliability pages. Verify the amber note appears. Switch back to "All Teams" — note should disappear.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "feat: show org-wide caveat on incident metrics when team filtered"
```

---

## Chunk 4: Architecture Update & Final Verification

### Task 9: Update ARCHITECTURE.md

**Files:**
- Modify: `specs/ARCHITECTURE.md`

- [ ] **Step 1: Update the Configuration section**

In `specs/ARCHITECTURE.md`, update the `config/repos.json` schema to reflect the new format (no `github_repos`, add `exclude_repos`). Add `config/teams.json` as a new config file with its schema.

- [ ] **Step 2: Update the API Contract section**

Add `GET /api/teams` to the READ endpoints list. Document the `?team=` query parameter on all PR-based endpoints.

- [ ] **Step 3: Update the File Boundaries table**

Add `config/teams.json` with responsibility "Team definitions and bot config" and "Must NOT contain: Code".

- [ ] **Step 4: Update the System Topology diagram**

Add `teams.json` to the config block in the ASCII diagram.

- [ ] **Step 5: Commit**

```bash
git add specs/ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md for dynamic repos and teams"
```

---

### Task 10: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Start server and run sanity check**

```bash
node server.js &
sleep 2
curl -s http://localhost:3201/api/sanity | python3 -m json.tool
```

Expected: All checks pass including `team_assignment_complete`. If unassigned contributors are flagged, update `config/teams.json`.

- [ ] **Step 2: Verify team filtering across pages**

Open `http://localhost:3201` and test:
1. Team dropdown visible with all 6 teams
2. Select "Core" → Overview shows fewer deploys, Cycle Time changes
3. Navigate to Cycle Time → still filtered to Core
4. Navigate to Reliability → shows org-wide caveat note
5. Select "All Teams" → back to org-wide data
6. Invalid team via URL: `http://localhost:3201/api/overview?team=FakeTeam` → 400 error

- [ ] **Step 3: Verify dynamic repo discovery**

```bash
.venv/bin/python3 fetch-github.py 2>&1 | head -5
```

Expected: "Discovering repos in paywithextend... Found N active repos..."

- [ ] **Step 4: Kill server**

```bash
kill %1
```

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
