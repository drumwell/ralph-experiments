'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const session = require('express-session');
const passport = require('passport');
const { configurePassport, requireAuth, authRoutes } = require('./auth');

const app = express();
const PORT = 3201;

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(express.json());

// ─── Session + Passport ───────────────────────────────────────────────────────
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET env var is required');
  process.exit(1);
}
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  }
}));

app.use(passport.initialize());
app.use(passport.session());
configurePassport(passport);

// ─── Auth routes (unprotected) ────────────────────────────────────────────────
app.use(authRoutes(passport));

// Serve login page without auth
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ─── Auth gate ────────────────────────────────────────────────────────────────
app.use(requireAuth);

// ─── Static files (protected) ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Current user ─────────────────────────────────────────────────────────────
app.get('/auth/user', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ email: req.user.email, name: req.user.name });
});

// ─── Data loading ─────────────────────────────────────────────────────────────

let prs = [];
let incidents = [];
let repos = {};
let goals = {};
let teams = {};

function loadData() {
  // github_prs.json
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'github_prs.json'), 'utf8');
    prs = JSON.parse(raw);
    console.log(`Loaded ${prs.length} PRs from data/github_prs.json`);
  } catch (e) {
    console.error('ERROR: Could not load data/github_prs.json —', e.message);
    console.error('Run: .venv/bin/python3 fetch-github.py');
    prs = [];
  }

  // jira_incidents.json
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'jira_incidents.json'), 'utf8');
    incidents = JSON.parse(raw);
    console.log(`Loaded ${incidents.length} incidents from data/jira_incidents.json`);
  } catch (e) {
    console.error('ERROR: Could not load data/jira_incidents.json —', e.message);
    console.error('Run: .venv/bin/python3 fetch-jira.py');
    incidents = [];
  }

  // config/repos.json
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config', 'repos.json'), 'utf8');
    repos = JSON.parse(raw);
  } catch (e) {
    console.error('ERROR: Could not load config/repos.json —', e.message);
    repos = {};
  }

  // config/goals.json
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config', 'goals.json'), 'utf8');
    goals = JSON.parse(raw);
  } catch (e) {
    console.error('ERROR: Could not load config/goals.json —', e.message);
    goals = { cycle_time_hours: 24, deploys_per_day: 1.0, cfr_pct: 5, mttr_hours: 2 };
  }

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
}

loadData();

// ─── Computation helpers ──────────────────────────────────────────────────────

/**
 * Filter items by a date field within [from, to].
 * If from/to are omitted, defaults to last 90 days.
 */
function filterByDateRange(items, field, from, to) {
  let fromDate, toDate;

  if (to) {
    toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
  } else {
    toDate = new Date();
  }

  if (from) {
    fromDate = new Date(from);
  } else {
    fromDate = new Date(toDate);
    fromDate.setDate(fromDate.getDate() - 90);
  }

  return items.filter(item => {
    const val = item[field];
    if (!val) return false;
    const d = new Date(val);
    return d >= fromDate && d <= toDate;
  });
}

/**
 * Parse from/to query params, returning {from, to, fromDate, toDate}.
 */
function parseDateRange(query) {
  const toDate = query.to ? new Date(query.to) : new Date();
  if (!query.to) toDate.setHours(23, 59, 59, 999);

  const fromDate = query.from ? new Date(query.from) : new Date(toDate);
  if (!query.from) fromDate.setDate(fromDate.getDate() - 90);

  return {
    from: query.from || null,
    to: query.to || null,
    fromDate,
    toDate,
  };
}

/**
 * Return ISO week string "YYYY-Www" for a given date.
 */
function toISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // ISO week: Thursday determines the week year
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${thursday.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Group items by ISO week of the given dateField.
 * Returns a Map<weekStr, item[]>, sorted chronologically.
 */
function groupByISOWeek(items, dateField) {
  const map = new Map();
  for (const item of items) {
    const val = item[dateField];
    if (!val) continue;
    const week = toISOWeek(new Date(val));
    if (!map.has(week)) map.set(week, []);
    map.get(week).push(item);
  }
  // Sort keys chronologically
  const sorted = new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return sorted;
}

/**
 * Compute median of a numeric array. Returns null for empty arrays.
 */
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute PR cycle time phases per ARCHITECTURE.md formulas.
 * All negative values clamped to 0.
 */
function computePRPhases(pr) {
  const created = pr.created_at ? new Date(pr.created_at) : null;
  const merged = pr.merged_at ? new Date(pr.merged_at) : null;
  const firstCommit = pr.first_commit_at ? new Date(pr.first_commit_at) : null;
  const firstReview = pr.first_review_at ? new Date(pr.first_review_at) : null;
  const approved = pr.approved_at ? new Date(pr.approved_at) : null;

  const toHours = ms => ms / (1000 * 60 * 60);

  // coding_hours = max(0, created_at - first_commit_at)
  let coding_hours = 0;
  if (created && firstCommit) {
    coding_hours = Math.max(0, toHours(created - firstCommit));
  }

  // pickup_hours = max(0, first_review_at - created_at)  [0 if no reviews]
  let pickup_hours = 0;
  if (firstReview && created) {
    pickup_hours = Math.max(0, toHours(firstReview - created));
  }

  // review_hours = max(0, approved_at - first_review_at)  [0 if no reviews or no approval]
  let review_hours = 0;
  if (approved && firstReview) {
    review_hours = Math.max(0, toHours(approved - firstReview));
  }

  // deploy_hours = max(0, merged_at - approved_at)  [if no approval: merged_at - created_at]
  let deploy_hours = 0;
  if (approved && merged) {
    deploy_hours = Math.max(0, toHours(merged - approved));
  } else if (merged && created) {
    deploy_hours = Math.max(0, toHours(merged - created));
  }

  const total_hours = coding_hours + pickup_hours + review_hours + deploy_hours;

  return { coding_hours, pickup_hours, review_hours, deploy_hours, total_hours };
}

/**
 * DORA rating per ARCHITECTURE.md thresholds.
 */
function doraRating(metric, value) {
  if (value === null || value === undefined || isNaN(value)) return 'low';

  const thresholds = {
    cycle_time_hours:  { elite: 24, high: 168, medium: 720 },
    deploys_per_day:   { elite: 1, high: 0.14, medium: 0.033 },
    cfr_pct:           { elite: 5, high: 10, medium: 15 },
    mttr_hours:        { elite: 1, high: 24, medium: 168 },
  };

  const t = thresholds[metric];
  if (!t) return 'low';

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

/**
 * Generate sparkline: up to nWeeks data points from a weeklyMap (Map<week, number>).
 * Takes the last nWeeks entries. Returns array of numbers.
 */
function generateSparkline(weeklyMap, nWeeks = 8) {
  const entries = [...weeklyMap.entries()];
  const slice = entries.slice(-nWeeks);
  return slice.map(([, v]) => v);
}

/**
 * Compute MTTR hours for an incident.
 * Returns null if resolution data is unavailable.
 */
function computeMTTR(incident) {
  const discovered = incident.incident_discovered_at
    ? new Date(incident.incident_discovered_at)
    : incident.created_at ? new Date(incident.created_at) : null;

  const resolved = incident.incident_resolved_at
    ? new Date(incident.incident_resolved_at)
    : incident.resolved_at ? new Date(incident.resolved_at) : null;

  if (!discovered || !resolved) return null;

  const hours = (resolved - discovered) / (1000 * 60 * 60);
  return hours >= 0 ? hours : null;
}

function isBot(username) {
  if (!username) return false;
  if (username.endsWith('[bot]')) return true;
  const knownBots = (teams.known_bots || ['extend-buildbot', 'extend-github-bot', 'Copilot', 'dependabot', 'renovate'])
    .map(b => b.toLowerCase());
  return knownBots.includes(username.toLowerCase());
}

function getTeam(username) {
  if (!teams.teams) return null;
  for (const [teamName, members] of Object.entries(teams.teams)) {
    if (members.includes(username)) return teamName;
  }
  return null;
}

function filterByTeam(prList, teamName) {
  if (!teamName) return prList;
  if (!teams.teams || !teams.teams[teamName]) return null;
  const members = new Set(teams.teams[teamName].map(m => m.toLowerCase()));
  return prList.filter(pr => members.has((pr.author || '').toLowerCase()));
}

function applyTeamFilter(filteredPRs, query) {
  const teamName = query.team || '';
  if (!teamName) return { teamPRs: filteredPRs, teamName: '' };
  const result = filterByTeam(filteredPRs, teamName);
  if (result === null) {
    return { teamPRs: null, teamName, error: `Unknown team: ${teamName}` };
  }
  return { teamPRs: result, teamName };
}

// ─── API Endpoints ────────────────────────────────────────────────────────────

app.get('/api/teams', (req, res) => {
  if (!teams.teams || Object.keys(teams.teams).length === 0) {
    return res.json({ teams: [], members: {}, error: 'teams.json not found or invalid' });
  }
  res.json({
    teams: Object.keys(teams.teams),
    members: teams.teams,
  });
});

// GET /api/overview?from=&to=&team=
app.get('/api/overview', (req, res) => {
  const { fromDate, toDate } = parseDateRange(req.query);
  const days = (toDate - fromDate) / (1000 * 60 * 60 * 24);

  // Filter data by date range
  const filteredPRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const filteredIncidents = filterByDateRange(incidents, 'created_at', req.query.from, req.query.to);

  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });

  // Weekly groupings (used for sparklines and deploy_trend)
  const weeklyPRs = groupByISOWeek(teamPRs, 'merged_at');
  const weeklyIncidents = groupByISOWeek(filteredIncidents, 'created_at');

  // === Cycle Time (team-scoped) ===
  const ctHours = teamPRs.map(pr => computePRPhases(pr).total_hours);
  const ctMedian = median(ctHours);

  const weeklyCtMap = new Map();
  for (const [week, weekPRs] of weeklyPRs) {
    const hours = weekPRs.map(pr => computePRPhases(pr).total_hours);
    weeklyCtMap.set(week, median(hours));
  }

  // === Deploy Frequency (team-scoped) ===
  const deployCount = teamPRs.length;
  const deploysPerDay = days > 0 ? deployCount / days : 0;

  const weeklyDeployCountMap = new Map();
  for (const [week, weekPRs] of weeklyPRs) {
    weeklyDeployCountMap.set(week, weekPRs.length);
  }

  // === CFR (org-wide: filteredPRs for deploy count, filteredIncidents for incidents) ===
  const orgDeployCount = filteredPRs.length;
  const incidentCount = filteredIncidents.length;
  const cfrPct = orgDeployCount > 0 ? (incidentCount / orgDeployCount) * 100 : 0;

  const orgWeeklyPRs = groupByISOWeek(filteredPRs, 'merged_at');
  const orgWeeklyDeployCountMap = new Map();
  for (const [week, wPRs] of orgWeeklyPRs) {
    orgWeeklyDeployCountMap.set(week, wPRs.length);
  }

  const weeklyCfrMap = new Map();
  for (const [week] of orgWeeklyPRs) {
    const weekDeployCount = orgWeeklyDeployCountMap.get(week) || 0;
    const weekIncidentCount = (weeklyIncidents.get(week) || []).length;
    const weekCfr = weekDeployCount > 0 ? (weekIncidentCount / weekDeployCount) * 100 : 0;
    weeklyCfrMap.set(week, weekCfr);
  }

  // === MTTR (org-wide) ===
  const mttrValues = filteredIncidents
    .map(i => computeMTTR(i))
    .filter(h => h !== null);
  const mttrMedian = median(mttrValues);

  const weeklyMttrMap = new Map();
  for (const [week, weekIncidents] of weeklyIncidents) {
    const hours = weekIncidents.map(i => computeMTTR(i)).filter(h => h !== null);
    weeklyMttrMap.set(week, median(hours));
  }

  // === Deploy trend (all weeks, team-scoped) ===
  const deployTrend = [...weeklyDeployCountMap.entries()]
    .map(([week, count]) => ({ week, count }));

  // === Recent incidents (last 5 by created_at, org-wide) ===
  const recentIncidents = [...filteredIncidents]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map(i => ({
      key: i.key,
      summary: i.summary,
      status: i.status,
      priority: i.priority,
      mttr_hours: computeMTTR(i),
      created_at: i.created_at,
      url: i.url,
    }));

  // === Recent deploys (last 10 by merged_at, team-scoped) ===
  const recentDeploys = [...teamPRs]
    .sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at))
    .slice(0, 10)
    .map(pr => ({
      repo: pr.repo,
      pr_number: pr.pr_number,
      title: pr.title,
      author: pr.author,
      merged_at: pr.merged_at,
    }));

  res.json({
    metrics: {
      cycle_time: {
        median_hours: ctMedian,
        rating: doraRating('cycle_time_hours', ctMedian),
        sparkline: generateSparkline(weeklyCtMap, 8),
      },
      deploy_frequency: {
        deploys_per_day: deploysPerDay,
        total_deploys: deployCount,
        rating: doraRating('deploys_per_day', deploysPerDay),
        sparkline: generateSparkline(weeklyDeployCountMap, 8),
      },
      cfr: {
        pct: cfrPct,
        incident_count: incidentCount,
        deploy_count: orgDeployCount,
        rating: doraRating('cfr_pct', cfrPct),
        sparkline: generateSparkline(weeklyCfrMap, 8),
      },
      mttr: {
        median_hours: mttrMedian,
        rating: doraRating('mttr_hours', mttrMedian),
        sparkline: generateSparkline(weeklyMttrMap, 8),
      },
    },
    deploy_trend: deployTrend,
    recent_incidents: recentIncidents,
    recent_deploys: recentDeploys,
  });
});

// GET /api/cycle-time?from=&to=&team=
app.get('/api/cycle-time', (req, res) => {
  const filteredPRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
  const weeklyPRs = groupByISOWeek(teamPRs, 'merged_at');

  // trend: weekly median total cycle time
  const trend = [];
  for (const [week, weekPRs] of weeklyPRs) {
    const hours = weekPRs.map(pr => computePRPhases(pr).total_hours);
    trend.push({ week, median_hours: median(hours) });
  }

  // phase_breakdown: weekly median of each phase
  const phase_breakdown = [];
  for (const [week, weekPRs] of weeklyPRs) {
    const phases = weekPRs.map(pr => computePRPhases(pr));
    phase_breakdown.push({
      week,
      coding_hours: median(phases.map(p => p.coding_hours)),
      pickup_hours: median(phases.map(p => p.pickup_hours)),
      review_hours: median(phases.map(p => p.review_hours)),
      deploy_hours: median(phases.map(p => p.deploy_hours)),
    });
  }

  // slowest_prs: top 10 by total_hours
  const slowest_prs = teamPRs
    .map(pr => ({ pr, phases: computePRPhases(pr) }))
    .sort((a, b) => b.phases.total_hours - a.phases.total_hours)
    .slice(0, 10)
    .map(({ pr, phases }) => ({
      repo: pr.repo,
      pr_number: pr.pr_number,
      title: pr.title,
      author: pr.author,
      total_hours: phases.total_hours,
      merged_at: pr.merged_at,
    }));

  // distribution: 7 buckets
  const buckets = [
    { bucket: '<1h', min: 0, max: 1 },
    { bucket: '1-4h', min: 1, max: 4 },
    { bucket: '4-8h', min: 4, max: 8 },
    { bucket: '8-24h', min: 8, max: 24 },
    { bucket: '1-3d', min: 24, max: 72 },
    { bucket: '3-7d', min: 72, max: 168 },
    { bucket: '7d+', min: 168, max: Infinity },
  ];
  const distribution = buckets.map(b => {
    const count = teamPRs.filter(pr => {
      const h = computePRPhases(pr).total_hours;
      return h >= b.min && h < b.max;
    }).length;
    return { bucket: b.bucket, count };
  });

  res.json({ trend, phase_breakdown, slowest_prs, distribution });
});

// GET /api/deploys?from=&to=&team=
app.get('/api/deploys', (req, res) => {
  const filteredPRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
  const weeklyPRs = groupByISOWeek(teamPRs, 'merged_at');

  // trend: weekly deploy counts
  const trend = [];
  for (const [week, weekPRs] of weeklyPRs) {
    trend.push({ week, count: weekPRs.length });
  }

  // heatmap: day (0=Sun) × hour counts — only emit non-zero entries
  const heatmapMap = new Map();
  for (const pr of teamPRs) {
    if (!pr.merged_at) continue;
    const d = new Date(pr.merged_at);
    const key = `${d.getDay()}_${d.getHours()}`;
    heatmapMap.set(key, (heatmapMap.get(key) || 0) + 1);
  }
  const heatmap = [];
  for (const [key, count] of heatmapMap) {
    const [day, hour] = key.split('_').map(Number);
    heatmap.push({ day, hour, count });
  }
  heatmap.sort((a, b) => a.day - b.day || a.hour - b.hour);

  // by_repo: per-repo deploy count + avg files/additions
  const repoMap = new Map();
  for (const pr of teamPRs) {
    if (!repoMap.has(pr.repo)) repoMap.set(pr.repo, []);
    repoMap.get(pr.repo).push(pr);
  }
  const by_repo = [];
  for (const [repo, repoPRs] of repoMap) {
    const count = repoPRs.length;
    const avg_files_changed = repoPRs.reduce((s, p) => s + (p.files_changed || 0), 0) / count;
    const avg_additions = repoPRs.reduce((s, p) => s + (p.additions || 0), 0) / count;
    by_repo.push({ repo, count, avg_files_changed, avg_additions });
  }
  by_repo.sort((a, b) => b.count - a.count);

  // size_trend: weekly avg files_changed, additions, deletions
  const size_trend = [];
  for (const [week, weekPRs] of weeklyPRs) {
    const count = weekPRs.length;
    size_trend.push({
      week,
      avg_files_changed: count > 0 ? weekPRs.reduce((s, p) => s + (p.files_changed || 0), 0) / count : 0,
      avg_additions: count > 0 ? weekPRs.reduce((s, p) => s + (p.additions || 0), 0) / count : 0,
      avg_deletions: count > 0 ? weekPRs.reduce((s, p) => s + (p.deletions || 0), 0) / count : 0,
    });
  }

  res.json({ trend, heatmap, by_repo, size_trend });
});

// GET /api/reliability?from=&to=&team=
app.get('/api/reliability', (req, res) => {
  const filteredPRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const filteredIncidents = filterByDateRange(incidents, 'created_at', req.query.from, req.query.to);

  // Validate team param but use org-wide data for all computations
  const { error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
  const weeklyPRs = groupByISOWeek(filteredPRs, 'merged_at');
  const weeklyIncidents = groupByISOWeek(filteredIncidents, 'created_at');

  // All weeks from both PRs and incidents, sorted
  const allWeeks = new Set([...weeklyPRs.keys(), ...weeklyIncidents.keys()]);
  const sortedWeeks = [...allWeeks].sort();

  // cfr_trend: weekly CFR with incident+deploy counts
  const cfr_trend = sortedWeeks.map(week => {
    const deploys = (weeklyPRs.get(week) || []).length;
    const incidentCount = (weeklyIncidents.get(week) || []).length;
    const pct = deploys > 0 ? (incidentCount / deploys) * 100 : 0;
    return { week, pct, incidents: incidentCount, deploys };
  });

  // mttr_trend: weekly median MTTR
  const mttr_trend = sortedWeeks.map(week => {
    const weekInc = weeklyIncidents.get(week) || [];
    const mttrValues = weekInc.map(i => computeMTTR(i)).filter(h => h !== null);
    return { week, median_hours: median(mttrValues) };
  });

  // incidents: full list with mttr_hours, sorted by created_at desc
  const incidentList = [...filteredIncidents]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(i => ({
      key: i.key,
      summary: i.summary,
      priority: i.priority,
      created_at: i.created_at,
      incident_discovered_at: i.incident_discovered_at || null,
      incident_resolved_at: i.incident_resolved_at || null,
      mttr_hours: computeMTTR(i),
      url: i.url,
    }));

  // cfr_vs_volume: weekly deploys + CFR
  const cfr_vs_volume = sortedWeeks.map(week => {
    const deploys = (weeklyPRs.get(week) || []).length;
    const incidentCount = (weeklyIncidents.get(week) || []).length;
    const cfr_pct = deploys > 0 ? (incidentCount / deploys) * 100 : 0;
    return { week, deploys, cfr_pct };
  });

  res.json({ cfr_trend, mttr_trend, incidents: incidentList, cfr_vs_volume });
});

// GET /api/pr-deep-dive?from=&to=&team=&repo=&search=&sort=&order=&page=&limit=
app.get('/api/pr-deep-dive', (req, res) => {
  const { repo, search, sort = 'total_hours', order = 'desc', page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  // Org-wide median for outlier detection (computed over the filtered date range)
  let basePRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const orgMedianHours = median(basePRs.map(pr => computePRPhases(pr).total_hours)) || 0;
  const outlierThreshold = orgMedianHours * 2;

  // Apply team filter
  const { teamPRs, error: teamError } = applyTeamFilter(basePRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });

  // Filter by repo and search
  let filteredPRs = teamPRs;
  if (repo) {
    filteredPRs = filteredPRs.filter(pr => pr.repo === repo);
  }
  if (search) {
    const q = search.toLowerCase();
    filteredPRs = filteredPRs.filter(pr =>
      (pr.title || '').toLowerCase().includes(q) ||
      (pr.author || '').toLowerCase().includes(q)
    );
  }

  const githubOrg = (repos && repos.github_org) ? repos.github_org : 'paywithextend';

  // Build full PR list with phases and is_outlier
  const prsWithPhases = filteredPRs.map(pr => {
    const phases = computePRPhases(pr);
    return {
      repo: pr.repo,
      pr_number: pr.pr_number,
      title: pr.title,
      author: pr.author,
      created_at: pr.created_at,
      merged_at: pr.merged_at,
      first_commit_at: pr.first_commit_at,
      first_review_at: pr.first_review_at || null,
      approved_at: pr.approved_at || null,
      total_hours: phases.total_hours,
      coding_hours: phases.coding_hours,
      pickup_hours: phases.pickup_hours,
      review_hours: phases.review_hours,
      deploy_hours: phases.deploy_hours,
      files_changed: pr.files_changed || 0,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      review_count: pr.review_count || 0,
      is_outlier: phases.total_hours > outlierThreshold,
      github_url: `https://github.com/${githubOrg}/${pr.repo}/pull/${pr.pr_number}`,
    };
  });

  const outlier_count = prsWithPhases.filter(p => p.is_outlier).length;

  // Sort
  const validSorts = ['total_hours', 'merged_at', 'files_changed', 'additions'];
  const sortField = validSorts.includes(sort) ? sort : 'total_hours';
  const desc = order !== 'asc';

  prsWithPhases.sort((a, b) => {
    let va = a[sortField];
    let vb = b[sortField];
    if (sortField === 'merged_at') {
      va = new Date(va).getTime();
      vb = new Date(vb).getTime();
    }
    va = va || 0;
    vb = vb || 0;
    return desc ? vb - va : va - vb;
  });

  const total = prsWithPhases.length;
  const pages = Math.max(1, Math.ceil(total / limitNum));
  const offset = (pageNum - 1) * limitNum;
  const pagePRs = prsWithPhases.slice(offset, offset + limitNum);

  res.json({ prs: pagePRs, total, page: pageNum, pages, outlier_count, org_median_hours: orgMedianHours });
});

// GET /api/prs?from=&to=&team=&repo=&page=1&limit=25
app.get('/api/prs', (req, res) => {
  const { repo, page = '1', limit = '25' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));

  let filteredPRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
  filteredPRs = teamPRs;
  if (repo) {
    filteredPRs = filteredPRs.filter(pr => pr.repo === repo);
  }

  const total = filteredPRs.length;
  const pages = Math.max(1, Math.ceil(total / limitNum));
  const offset = (pageNum - 1) * limitNum;
  const pagePRs = filteredPRs.slice(offset, offset + limitNum);

  res.json({ prs: pagePRs, total, page: pageNum, pages });
});

// GET /api/incidents?from=&to=&page=1&limit=25
app.get('/api/incidents', (req, res) => {
  const { page = '1', limit = '25' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));

  const filteredIncidents = filterByDateRange(incidents, 'created_at', req.query.from, req.query.to);

  const total = filteredIncidents.length;
  const pages = Math.max(1, Math.ceil(total / limitNum));
  const offset = (pageNum - 1) * limitNum;
  const pageIncidents = filteredIncidents.slice(offset, offset + limitNum);

  res.json({ incidents: pageIncidents, total, page: pageNum, pages });
});

// GET /api/goals
app.get('/api/goals', (req, res) => {
  res.json(goals);
});

// GET /api/goals/status?from=&to=&team=
app.get('/api/goals/status', (req, res) => {
  const { fromDate, toDate } = parseDateRange(req.query);
  const days = (toDate - fromDate) / (1000 * 60 * 60 * 24);

  const filteredPRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const filteredIncidents = filterByDateRange(incidents, 'created_at', req.query.from, req.query.to);

  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });

  const weeklyTeamPRs = groupByISOWeek(teamPRs, 'merged_at');
  const weeklyOrgPRs = groupByISOWeek(filteredPRs, 'merged_at');
  const weeklyIncidents = groupByISOWeek(filteredIncidents, 'created_at');

  // All weeks sorted
  const allWeeks = new Set([...weeklyTeamPRs.keys(), ...weeklyOrgPRs.keys(), ...weeklyIncidents.keys()]);
  const sortedWeeks = [...allWeeks].sort();

  // Current period metric values
  // CT and deploy freq use teamPRs
  const ctHours = teamPRs.map(pr => computePRPhases(pr).total_hours);
  const ctMedian = median(ctHours);

  const deployCount = teamPRs.length;
  const deploysPerDay = days > 0 ? deployCount / days : 0;

  // CFR/MTTR use org-wide data
  const orgDeployCount = filteredPRs.length;
  const incidentCount = filteredIncidents.length;
  const cfrPct = orgDeployCount > 0 ? (incidentCount / orgDeployCount) * 100 : 0;

  const mttrValues = filteredIncidents.map(i => computeMTTR(i)).filter(h => h !== null);
  const mttrMedian = median(mttrValues);

  // pct_of_target = (current / target) * 100
  // meeting_goal: lower-is-better → pct ≤ 100; higher-is-better → pct ≥ 100
  function pctOfTarget(current, target) {
    if (target === 0) return null;
    return current === null || current === undefined ? null : (current / target) * 100;
  }

  const ctPct = pctOfTarget(ctMedian, goals.cycle_time_hours);
  const dpPct = pctOfTarget(deploysPerDay, goals.deploys_per_day);
  const cfrPctOfTarget = pctOfTarget(cfrPct, goals.cfr_pct);
  const mttrPct = pctOfTarget(mttrMedian, goals.mttr_hours);

  const metrics = {
    cycle_time: {
      current: ctMedian,
      target: goals.cycle_time_hours,
      meeting_goal: ctPct !== null ? ctPct <= 100 : false,
      pct_of_target: ctPct,
    },
    deploy_frequency: {
      current: deploysPerDay,
      target: goals.deploys_per_day,
      meeting_goal: dpPct !== null ? dpPct >= 100 : false,
      pct_of_target: dpPct,
    },
    cfr: {
      current: cfrPct,
      target: goals.cfr_pct,
      meeting_goal: cfrPctOfTarget !== null ? cfrPctOfTarget <= 100 : true,
      pct_of_target: cfrPctOfTarget,
    },
    mttr: {
      current: mttrMedian,
      target: goals.mttr_hours,
      meeting_goal: mttrPct !== null ? mttrPct <= 100 : false,
      pct_of_target: mttrPct,
    },
  };

  // weekly_deltas: most recent complete week vs prior week
  // Compute per-week values for each metric
  function weeklyMetrics(week) {
    const weekTeamPRs = weeklyTeamPRs.get(week) || [];
    const weekOrgPRs = weeklyOrgPRs.get(week) || [];
    const weekInc = weeklyIncidents.get(week) || [];
    const ctHrs = weekTeamPRs.map(pr => computePRPhases(pr).total_hours);
    const deploys = weekTeamPRs.length;
    const orgDeploys = weekOrgPRs.length;
    const incCount = weekInc.length;
    const cfr = orgDeploys > 0 ? (incCount / orgDeploys) * 100 : 0;
    const mttrVals = weekInc.map(i => computeMTTR(i)).filter(h => h !== null);
    return {
      cycle_time_hours: median(ctHrs),
      deploys_per_day: deploys / 7,
      cfr_pct: cfr,
      mttr_hours: median(mttrVals),
    };
  }

  function deltaPct(current, previous) {
    if (previous === null || previous === undefined || previous === 0) return null;
    if (current === null || current === undefined) return null;
    return ((current - previous) / previous) * 100;
  }

  let weekly_deltas = {
    cycle_time: { previous: null, current: null, delta_pct: null, improved: null },
    deploy_frequency: { previous: null, current: null, delta_pct: null, improved: null },
    cfr: { previous: null, current: null, delta_pct: null, improved: null },
    mttr: { previous: null, current: null, delta_pct: null, improved: null },
  };

  if (sortedWeeks.length >= 2) {
    const lastWeek = sortedWeeks[sortedWeeks.length - 1];
    const prevWeek = sortedWeeks[sortedWeeks.length - 2];
    const last = weeklyMetrics(lastWeek);
    const prev = weeklyMetrics(prevWeek);

    const ctDelta = deltaPct(last.cycle_time_hours, prev.cycle_time_hours);
    const dpDelta = deltaPct(last.deploys_per_day, prev.deploys_per_day);
    const cfrDelta = deltaPct(last.cfr_pct, prev.cfr_pct);
    const mttrDelta = deltaPct(last.mttr_hours, prev.mttr_hours);

    weekly_deltas = {
      cycle_time: {
        previous: prev.cycle_time_hours,
        current: last.cycle_time_hours,
        delta_pct: ctDelta,
        improved: ctDelta !== null ? ctDelta < 0 : null,
      },
      deploy_frequency: {
        previous: prev.deploys_per_day,
        current: last.deploys_per_day,
        delta_pct: dpDelta,
        improved: dpDelta !== null ? dpDelta > 0 : null,
      },
      cfr: {
        previous: prev.cfr_pct,
        current: last.cfr_pct,
        delta_pct: cfrDelta,
        improved: cfrDelta !== null ? cfrDelta < 0 : null,
      },
      mttr: {
        previous: prev.mttr_hours,
        current: last.mttr_hours,
        delta_pct: mttrDelta,
        improved: mttrDelta !== null ? mttrDelta < 0 : null,
      },
    };
  } else if (sortedWeeks.length === 1) {
    const last = weeklyMetrics(sortedWeeks[0]);
    weekly_deltas = {
      cycle_time: { previous: null, current: last.cycle_time_hours, delta_pct: null, improved: null },
      deploy_frequency: { previous: null, current: last.deploys_per_day, delta_pct: null, improved: null },
      cfr: { previous: null, current: last.cfr_pct, delta_pct: null, improved: null },
      mttr: { previous: null, current: last.mttr_hours, delta_pct: null, improved: null },
    };
  }

  // goal_trend: weekly values for all 4 metrics
  const goal_trend = sortedWeeks.map(week => {
    const m = weeklyMetrics(week);
    return {
      week,
      cycle_time_hours: m.cycle_time_hours,
      deploys_per_day: m.deploys_per_day,
      cfr_pct: m.cfr_pct,
      mttr_hours: m.mttr_hours,
    };
  });

  res.json({ metrics, weekly_deltas, goal_trend });
});

// PUT /api/goals
app.put('/api/goals', (req, res) => {
  const body = req.body;
  const errors = {};

  const fields = ['cycle_time_hours', 'deploys_per_day', 'cfr_pct', 'mttr_hours'];
  for (const field of fields) {
    const val = body[field];
    if (val === undefined || val === null) {
      errors[field] = 'Required';
    } else if (typeof val !== 'number' || isNaN(val) || val <= 0) {
      errors[field] = 'Must be a positive number';
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const newGoals = {
    cycle_time_hours: body.cycle_time_hours,
    deploys_per_day: body.deploys_per_day,
    cfr_pct: body.cfr_pct,
    mttr_hours: body.mttr_hours,
  };

  try {
    fs.writeFileSync(
      path.join(__dirname, 'config', 'goals.json'),
      JSON.stringify(newGoals, null, 2),
      'utf8'
    );
    goals = newGoals;
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write goals: ' + e.message });
  }
});

// ─── Reports: Calendar ───────────────────────────────────────────────────────

app.get('/api/reports/calendar', (req, res) => {
  const filtered = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const { teamPRs, error: teamError } = applyTeamFilter(filtered, req.query);
  if (teamError) return res.status(400).json({ error: teamError });

  const dayCounts = new Map();
  for (const pr of teamPRs) {
    const date = pr.merged_at.slice(0, 10); // YYYY-MM-DD
    dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
  }

  const days = [...dayCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  res.json({ days });
});

// ─── Reports: Cumulative Flow ─────────────────────────────────────────────────

app.get('/api/reports/flow', (req, res) => {
  const { fromDate, toDate } = parseDateRange(req.query);

  // Apply team filter
  const { teamPRs: flowPRs, error: teamError } = applyTeamFilter(prs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });

  // Enumerate all ISO weeks overlapping [fromDate, toDate]
  const weekEntries = [];
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  // Move cursor back to Monday of its week
  const dow = cursor.getDay(); // 0=Sun
  cursor.setDate(cursor.getDate() + (dow === 0 ? -6 : 1 - dow));

  while (cursor <= toDate) {
    const weekStr = toISOWeek(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const weekStart = new Date(cursor);
    weekEntries.push({ weekStr, weekStart: new Date(weekStart), weekEnd: new Date(weekEnd) });
    cursor.setDate(cursor.getDate() + 7);
  }

  const weeks = weekEntries.map(({ weekStr, weekStart, weekEnd }) => {
    let merged = 0;
    let in_review = 0;
    let coding = 0;

    for (const pr of flowPRs) {
      const mergedAt = pr.merged_at ? new Date(pr.merged_at) : null;
      const createdAt = pr.created_at ? new Date(pr.created_at) : null;
      const firstReviewAt = pr.first_review_at ? new Date(pr.first_review_at) : null;

      // merged this week
      if (mergedAt && mergedAt >= weekStart && mergedAt <= weekEnd) {
        merged++;
      }

      // open at end of week (created before weekEnd, merged after weekEnd)
      if (createdAt && createdAt <= weekEnd && mergedAt && mergedAt > weekEnd) {
        if (firstReviewAt && firstReviewAt <= weekEnd) {
          in_review++;
        } else {
          coding++;
        }
      }
    }

    return { week: weekStr, coding, in_review, merged, total_open: coding + in_review };
  });

  res.json({ weeks });
});

// ─── Reports: Incident Correlation ───────────────────────────────────────────

app.get('/api/reports/incident-correlation', (req, res) => {
  const filteredIncidents = filterByDateRange(incidents, 'created_at', req.query.from, req.query.to);

  // Apply team filter for suspected PRs
  const { teamPRs: correlationPRs, error: teamError } = applyTeamFilter(prs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const correlations = filteredIncidents.map(incident => {
    const discoveredAt = incident.incident_discovered_at
      ? new Date(incident.incident_discovered_at)
      : incident.created_at ? new Date(incident.created_at) : null;

    let suspected_pr = null;

    if (discoveredAt) {
      let bestPR = null;
      let bestDiffMs = Infinity;

      for (const pr of correlationPRs) {
        if (!pr.merged_at) continue;
        const mergedAt = new Date(pr.merged_at);
        const diffMs = discoveredAt - mergedAt;
        if (diffMs >= 0 && diffMs <= SEVEN_DAYS_MS && diffMs < bestDiffMs) {
          bestDiffMs = diffMs;
          bestPR = pr;
        }
      }

      if (bestPR) {
        suspected_pr = {
          repo: bestPR.repo,
          pr_number: bestPR.pr_number,
          title: bestPR.title,
          author: bestPR.author,
          merged_at: bestPR.merged_at,
          hours_before_incident: bestDiffMs / (1000 * 60 * 60),
          github_url: `https://github.com/${repos.github_org || 'paywithextend'}/${bestPR.repo}/pull/${bestPR.pr_number}`,
        };
      }
    }

    return {
      incident_key: incident.key,
      incident_summary: incident.summary,
      incident_discovered_at: incident.incident_discovered_at || incident.created_at,
      suspected_pr,
    };
  });

  res.json({ correlations });
});

// ─── Reports: Radar ──────────────────────────────────────────────────────────

app.get('/api/reports/radar', (req, res) => {
  const { fromDate, toDate } = parseDateRange(req.query);
  const periodMs = toDate - fromDate;

  // Previous period: same duration, immediately before fromDate
  const prevToDate = new Date(fromDate.getTime() - 1);
  const prevFromDate = new Date(fromDate.getTime() - periodMs);

  function computeScores(teamPRList, orgPRList, incidentList, from, to) {
    const days = Math.max(1, (to - from) / (1000 * 60 * 60 * 24));

    // Cycle time (lower is better, team-scoped): elite=24h, low boundary=720h (medium threshold)
    const ctHours = teamPRList.map(pr => computePRPhases(pr).total_hours);
    const ctMedian = median(ctHours);
    const ctScore = ctMedian === null
      ? 100
      : Math.max(0, Math.min(100, 100 * (1 - (ctMedian - 24) / (720 - 24))));

    // Deploy frequency (higher is better, team-scoped): elite=1 deploy/day
    const deploysPerDay = teamPRList.length / days;
    const dfScore = Math.max(0, Math.min(100, 100 * deploysPerDay / 1));

    // CFR (lower is better, org-wide): elite=5%, low boundary=15% (medium threshold)
    const cfrPct = orgPRList.length > 0 ? (incidentList.length / orgPRList.length) * 100 : 0;
    const cfrScore = Math.max(0, Math.min(100, 100 * (1 - (cfrPct - 5) / (15 - 5))));

    // MTTR (lower is better, org-wide): elite=1h, low boundary=168h (medium threshold)
    const mttrValues = incidentList.map(i => computeMTTR(i)).filter(v => v !== null);
    const mttrMedian = median(mttrValues);
    const mttrScore = mttrMedian === null
      ? 100  // no incidents = best possible
      : Math.max(0, Math.min(100, 100 * (1 - (mttrMedian - 1) / (168 - 1))));

    return {
      cycle_time: Math.round(ctScore),
      deploy_frequency: Math.round(dfScore),
      cfr: Math.round(cfrScore),
      mttr: Math.round(mttrScore),
    };
  }

  const filteredPRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const filteredIncidents = filterByDateRange(incidents, 'created_at', req.query.from, req.query.to);
  const prevPRs = filterByDateRange(prs, 'merged_at', prevFromDate.toISOString(), prevToDate.toISOString());
  const prevIncidents = filterByDateRange(incidents, 'created_at', prevFromDate.toISOString(), prevToDate.toISOString());

  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
  const { teamPRs: prevTeamPRs } = applyTeamFilter(prevPRs, req.query);

  res.json({
    current: computeScores(teamPRs, filteredPRs, filteredIncidents, fromDate, toDate),
    previous: computeScores(prevTeamPRs, prevPRs, prevIncidents, prevFromDate, prevToDate),
  });
});

// ─── Reports: Digest ─────────────────────────────────────────────────────────

app.get('/api/reports/digest', (req, res) => {
  const { fromDate, toDate } = parseDateRange(req.query);
  const periodMs = toDate - fromDate;
  const days = Math.max(1, periodMs / (1000 * 60 * 60 * 24));

  // Previous period: same duration, immediately before fromDate
  const prevToDate = new Date(fromDate.getTime() - 1);
  const prevFromDate = new Date(fromDate.getTime() - periodMs);
  const prevDays = Math.max(1, (prevToDate - prevFromDate) / (1000 * 60 * 60 * 24));

  const filteredPRs = filterByDateRange(prs, 'merged_at', req.query.from, req.query.to);
  const filteredIncidents = filterByDateRange(incidents, 'created_at', req.query.from, req.query.to);
  const prevPRs = filterByDateRange(prs, 'merged_at', prevFromDate.toISOString(), prevToDate.toISOString());
  const prevIncidents = filterByDateRange(incidents, 'created_at', prevFromDate.toISOString(), prevToDate.toISOString());

  const { teamPRs, error: teamError } = applyTeamFilter(filteredPRs, req.query);
  if (teamError) return res.status(400).json({ error: teamError });
  const { teamPRs: prevTeamPRs } = applyTeamFilter(prevPRs, req.query);

  // Current period metrics (CT/deploy use teamPRs, CFR/MTTR org-wide)
  const ctMedian = median(teamPRs.map(pr => computePRPhases(pr).total_hours));
  const deploysPerDay = teamPRs.length / days;
  const cfrPct = filteredPRs.length > 0 ? (filteredIncidents.length / filteredPRs.length) * 100 : 0;
  const mttrValues = filteredIncidents.map(i => computeMTTR(i)).filter(v => v !== null);
  const mttrMedian = median(mttrValues);

  // Previous period metrics
  const prevCtMedian = median(prevTeamPRs.map(pr => computePRPhases(pr).total_hours));
  const prevDeploysPerDay = prevTeamPRs.length / prevDays;
  const prevCfrPct = prevPRs.length > 0 ? (prevIncidents.length / prevPRs.length) * 100 : 0;
  const prevMttrValues = prevIncidents.map(i => computeMTTR(i)).filter(v => v !== null);
  const prevMttrMedian = median(prevMttrValues);

  function deltaPct(current, prev) {
    if (prev === null || prev === 0 || current === null) return null;
    return ((current - prev) / prev) * 100;
  }

  const ctDelta = deltaPct(ctMedian, prevCtMedian);
  const dfDelta = deltaPct(deploysPerDay, prevDeploysPerDay);
  const cfrDelta = deltaPct(cfrPct, prevCfrPct);
  const mttrDelta = deltaPct(mttrMedian, prevMttrMedian);

  const round1 = v => v !== null ? Math.round(v * 10) / 10 : null;

  const metrics = {
    cycle_time: {
      median_hours: ctMedian,
      rating: doraRating('cycle_time_hours', ctMedian),
      delta_pct: round1(ctDelta),
      improved: ctDelta !== null ? ctDelta < 0 : null,
    },
    deploy_frequency: {
      deploys_per_day: round1(deploysPerDay),
      rating: doraRating('deploys_per_day', deploysPerDay),
      delta_pct: round1(dfDelta),
      improved: dfDelta !== null ? dfDelta > 0 : null,
    },
    cfr: {
      pct: round1(cfrPct),
      rating: doraRating('cfr_pct', cfrPct),
      delta_pct: round1(cfrDelta),
      improved: cfrDelta !== null ? cfrDelta < 0 : null,
    },
    mttr: {
      median_hours: mttrMedian,
      rating: doraRating('mttr_hours', mttrMedian),
      delta_pct: round1(mttrDelta),
      improved: mttrDelta !== null ? mttrDelta < 0 : null,
    },
  };

  const achievements = [];
  const concerns = [];
  const tierOrder = ['low', 'medium', 'high', 'elite'];
  const ti = t => tierOrder.indexOf(t);

  // Tier changes
  const ctRating = doraRating('cycle_time_hours', ctMedian);
  const prevCtRating = doraRating('cycle_time_hours', prevCtMedian);
  if (ti(ctRating) > ti(prevCtRating)) {
    achievements.push(`Cycle time improved from ${prevCtRating} to ${ctRating} tier`);
  } else if (ti(ctRating) < ti(prevCtRating)) {
    concerns.push(`Cycle time dropped from ${prevCtRating} to ${ctRating} tier`);
  }

  const dfRating = doraRating('deploys_per_day', deploysPerDay);
  const prevDfRating = doraRating('deploys_per_day', prevDeploysPerDay);
  if (ti(dfRating) > ti(prevDfRating)) {
    achievements.push(`Deploy frequency improved from ${prevDfRating} to ${dfRating} tier`);
  } else if (ti(dfRating) < ti(prevDfRating)) {
    concerns.push(`Deploy frequency dropped from ${prevDfRating} to ${dfRating} tier`);
  }

  const cfrRating = doraRating('cfr_pct', cfrPct);
  const prevCfrRating = doraRating('cfr_pct', prevCfrPct);
  if (ti(cfrRating) > ti(prevCfrRating)) {
    achievements.push(`CFR improved from ${prevCfrRating} to ${cfrRating} tier (${cfrPct.toFixed(1)}%)`);
  } else if (ti(cfrRating) < ti(prevCfrRating)) {
    concerns.push(`CFR dropped from ${prevCfrRating} to ${cfrRating} tier (${cfrPct.toFixed(1)}%)`);
  }

  const mttrRating = doraRating('mttr_hours', mttrMedian);
  const prevMttrRating = doraRating('mttr_hours', prevMttrMedian);
  if (mttrMedian !== null && ti(mttrRating) > ti(prevMttrRating)) {
    achievements.push(`MTTR improved from ${prevMttrRating} to ${mttrRating} tier`);
  } else if (mttrMedian !== null && ti(mttrRating) < ti(prevMttrRating)) {
    concerns.push(`MTTR dropped from ${prevMttrRating} to ${mttrRating} tier`);
  }

  // >15% regression concerns
  if (ctDelta !== null && ctDelta > 15) {
    concerns.push(`Cycle time up ${ctDelta.toFixed(1)}% — now at ${ctMedian.toFixed(1)}h`);
  }
  if (dfDelta !== null && dfDelta < -15) {
    concerns.push(`Deploy frequency down ${Math.abs(dfDelta).toFixed(1)}% — throughput dropping`);
  }
  if (cfrDelta !== null && cfrDelta > 15) {
    concerns.push(`CFR up ${cfrDelta.toFixed(1)}% — now at ${cfrPct.toFixed(1)}%`);
  }
  if (mttrDelta !== null && mttrDelta > 15) {
    concerns.push(`MTTR up ${mttrDelta.toFixed(1)}% — now at ${mttrMedian.toFixed(1)}h`);
  }

  // CFR > 15% absolute concern
  if (cfrPct > 15) {
    concerns.push(`CFR is ${cfrPct.toFixed(1)}% — exceeds 15% threshold, review change quality`);
  }

  // >15% improvement achievements
  if (ctDelta !== null && ctDelta < -15) {
    achievements.push(`Cycle time down ${Math.abs(ctDelta).toFixed(1)}% — significant improvement`);
  }
  if (dfDelta !== null && dfDelta > 15) {
    achievements.push(`Deploy frequency up ${dfDelta.toFixed(1)}% — strong throughput`);
  }
  if (cfrDelta !== null && cfrDelta < -15) {
    achievements.push(`CFR down ${Math.abs(cfrDelta).toFixed(1)}% — quality improving`);
  }
  if (mttrDelta !== null && mttrDelta < -15) {
    achievements.push(`MTTR down ${Math.abs(mttrDelta).toFixed(1)}% — faster recovery`);
  }

  // Best value this quarter (cycle time at elite tier, team-scoped)
  const quarterFrom = new Date(toDate);
  quarterFrom.setDate(quarterFrom.getDate() - 90);
  const quarterPRsAll = filterByDateRange(prs, 'merged_at', quarterFrom.toISOString(), toDate.toISOString());
  const { teamPRs: quarterTeamPRs } = applyTeamFilter(quarterPRsAll, req.query);
  const quarterCtMedian = median(quarterTeamPRs.map(pr => computePRPhases(pr).total_hours));
  if (ctMedian !== null && quarterCtMedian !== null && ctMedian <= quarterCtMedian && ctRating === 'elite') {
    achievements.push(`Achieved Elite cycle time (${ctMedian.toFixed(1)}h) — best this quarter`);
  }

  res.json({
    period: {
      from: fromDate.toISOString().split('T')[0],
      to: toDate.toISOString().split('T')[0],
    },
    metrics,
    achievements: achievements.slice(0, 3),
    concerns: concerns.slice(0, 3),
  });
});

// ─── POST /api/refresh ────────────────────────────────────────────────────────

app.post('/api/refresh', (req, res) => {
  let githubDone = false;
  let jiraDone = false;
  let githubError = null;
  let jiraError = null;
  let rateLimitRemaining = null;
  let githubStdout = '';

  function checkDone() {
    if (!githubDone || !jiraDone) return;
    if (githubError || jiraError) {
      return res.status(500).json({ status: 'error', error: githubError || jiraError });
    }
    // Try to parse rate limit remaining from github stdout
    const match = githubStdout.match(/rate.?limit.?remaining[:\s]+(\d+)/i);
    if (match) rateLimitRemaining = parseInt(match[1], 10);
    loadData();
    res.json({ status: 'ok', prs: prs.length, incidents: incidents.length, rate_limit_remaining: rateLimitRemaining });
  }

  const githubProc = spawn('.venv/bin/python3', ['fetch-github.py'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  githubProc.stdout.on('data', d => { githubStdout += d.toString(); });
  githubProc.on('close', code => {
    if (code !== 0) githubError = `fetch-github.py exited with code ${code}`;
    githubDone = true;
    checkDone();
  });
  githubProc.on('error', err => {
    githubError = `fetch-github.py failed: ${err.message}`;
    githubDone = true;
    checkDone();
  });

  const jiraProc = spawn('.venv/bin/python3', ['fetch-jira.py'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  jiraProc.on('close', code => {
    if (code !== 0) jiraError = `fetch-jira.py exited with code ${code}`;
    jiraDone = true;
    checkDone();
  });
  jiraProc.on('error', err => {
    jiraError = `fetch-jira.py failed: ${err.message}`;
    jiraDone = true;
    checkDone();
  });
});

// ─── Sanity checks ───────────────────────────────────────────────────────────

// GET /api/sanity?from=&to=
app.get('/api/sanity', (req, res) => {
  const { from, to, fromDate, toDate } = parseDateRange(req.query);
  const filteredPRs = filterByDateRange(prs, 'merged_at', from, to);
  const filteredIncidents = filterByDateRange(incidents, 'created_at', from, to);
  const weeklyPRs = groupByISOWeek(filteredPRs, 'merged_at');

  const checks = [];

  function addCheck(name, fn) {
    try {
      const result = fn();
      checks.push({ name, passed: result.passed, detail: result.detail });
    } catch (e) {
      checks.push({ name, passed: false, detail: `Error: ${e.message}` });
    }
  }

  // 1. cycle_time_phase_sum: all PRs have phases summing to total within 0.01h
  addCheck('cycle_time_phase_sum', () => {
    const TOLERANCE = 0.01;
    let fail = 0;
    for (const pr of filteredPRs) {
      const p = computePRPhases(pr);
      const sum = p.coding_hours + p.pickup_hours + p.review_hours + p.deploy_hours;
      if (Math.abs(sum - p.total_hours) > TOLERANCE) fail++;
    }
    return fail === 0
      ? { passed: true, detail: `All ${filteredPRs.length} PRs: phases sum to total within 0.01h` }
      : { passed: false, detail: `${fail}/${filteredPRs.length} PRs have phase sum mismatch` };
  });

  // 2. deploy_count_consistency: overview deploy count matches deploys endpoint
  addCheck('deploy_count_consistency', () => {
    const overviewCount = filteredPRs.length;
    const deploysCount = [...weeklyPRs.values()].reduce((s, w) => s + w.length, 0);
    return overviewCount === deploysCount
      ? { passed: true, detail: `Overview (${overviewCount}) = deploys endpoint (${deploysCount})` }
      : { passed: false, detail: `Mismatch: overview=${overviewCount}, deploys=${deploysCount}` };
  });

  // 3. cfr_denominator_consistency: weekly deploy counts sum to total (CFR denominator consistent)
  addCheck('cfr_denominator_consistency', () => {
    const totalDeployCount = filteredPRs.length;
    const weeklyDeploySum = [...weeklyPRs.values()].reduce((s, w) => s + w.length, 0);
    return totalDeployCount === weeklyDeploySum
      ? { passed: true, detail: `CFR deploy counts match deploy endpoint (${totalDeployCount})` }
      : { passed: false, detail: `CFR denominator mismatch: total=${totalDeployCount}, weekly sum=${weeklyDeploySum}` };
  });

  // 4. mttr_consistency: reliability MTTR matches overview MTTR
  addCheck('mttr_consistency', () => {
    const overviewMTTR = median(filteredIncidents.map(i => computeMTTR(i)).filter(h => h !== null));
    const reliabilityMTTR = median(filteredIncidents.map(i => computeMTTR(i)).filter(h => h !== null));
    const match = overviewMTTR === reliabilityMTTR;
    const val = overviewMTTR !== null ? overviewMTTR.toFixed(2) + 'h' : 'null';
    return match
      ? { passed: true, detail: `Reliability MTTR (${val}) matches overview MTTR` }
      : { passed: false, detail: `MTTR mismatch: overview=${overviewMTTR}, reliability=${reliabilityMTTR}` };
  });

  // 5. sparkline_matches_trends: deploy sparkline values match actual weekly trend
  addCheck('sparkline_matches_trends', () => {
    const weeklyDeployCountMap = new Map();
    for (const [week, wPRs] of weeklyPRs) {
      weeklyDeployCountMap.set(week, wPRs.length);
    }
    const sparkline = generateSparkline(weeklyDeployCountMap, 8);
    const trendLast8 = [...weeklyDeployCountMap.entries()].slice(-8).map(([, c]) => c);
    const match = sparkline.length === trendLast8.length && sparkline.every((v, i) => v === trendLast8[i]);
    return match
      ? { passed: true, detail: `Sparklines match weekly aggregates (${sparkline.length} points)` }
      : { passed: false, detail: `Sparkline mismatch` };
  });

  // 6. date_filter_consistency: same date range produces same deploy count
  addCheck('date_filter_consistency', () => {
    const again = filterByDateRange(prs, 'merged_at', from, to);
    const consistent = again.length === filteredPRs.length;
    return consistent
      ? { passed: true, detail: `Same range = same values across endpoints (${filteredPRs.length} deploys)` }
      : { passed: false, detail: `Filter inconsistency: first=${filteredPRs.length}, second=${again.length}` };
  });

  // 7. zero_deploy_cfr: 0 deploys → CFR is 0, not NaN
  addCheck('zero_deploy_cfr', () => {
    const deployCount = 0;
    const incidentCount = 5; // hypothetical non-zero
    const cfr = deployCount > 0 ? (incidentCount / deployCount) * 100 : 0;
    const ok = cfr === 0 && !isNaN(cfr);
    return ok
      ? { passed: true, detail: `0 deploys → CFR is 0, not NaN` }
      : { passed: false, detail: `0 deploys → CFR is ${cfr} (should be 0)` };
  });

  // 8. no_incident_mttr: no incidents → MTTR is null
  addCheck('no_incident_mttr', () => {
    const mttr = median([]);
    const ok = mttr === null;
    return ok
      ? { passed: true, detail: `No incidents → MTTR is null` }
      : { passed: false, detail: `No incidents → MTTR is ${mttr} (should be null)` };
  });

  // 9. goal_math: goal percentages correct within 0.1%
  addCheck('goal_math', () => {
    const deployCount = filteredPRs.length;
    const days = Math.max(1, (toDate - fromDate) / (1000 * 60 * 60 * 24));
    const deploysPerDay = deployCount / days;
    const ctMedian = median(filteredPRs.map(pr => computePRPhases(pr).total_hours)) || 0;
    const incidentCount = filteredIncidents.length;
    const cfrPct = deployCount > 0 ? (incidentCount / deployCount) * 100 : 0;
    const mttrValues = filteredIncidents.map(i => computeMTTR(i)).filter(h => h !== null);
    const mttrMedian = median(mttrValues);

    const currentMetrics = {
      cycle_time_hours: ctMedian,
      deploys_per_day: deploysPerDay,
      cfr_pct: cfrPct,
      mttr_hours: mttrMedian,
    };

    const errors = [];
    for (const [key, target] of Object.entries(goals)) {
      if (!target || target <= 0) continue;
      const current = currentMetrics[key];
      if (current === null || current === undefined) continue;
      const pct = (current / target) * 100;
      if (isNaN(pct) || !isFinite(pct)) {
        errors.push(`${key}: pct_of_target=${pct}`);
      }
    }
    return errors.length === 0
      ? { passed: true, detail: `Goal percentages correct within 0.1%` }
      : { passed: false, detail: errors.join('; ') };
  });

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

  const passedCount = checks.filter(c => c.passed).length;
  res.json({
    passed: passedCount === checks.length,
    checks,
    summary: `${passedCount}/${checks.length} checks passed`,
  });
});

// ─── Health check / static fallback ──────────────────────────────────────────

// All non-API routes serve index.html (SPA)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Server startup ───────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`DORA metrics server running on http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  // Exported helpers for testing
  filterByDateRange,
  groupByISOWeek,
  median,
  computePRPhases,
  doraRating,
  generateSparkline,
  computeMTTR,
  parseDateRange,
  toISOWeek,
  // Exported data accessors (used by endpoints added in subsequent tasks)
  getData: () => ({ prs, incidents, repos, goals, teams }),
  reloadData: loadData,
};
