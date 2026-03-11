'use strict';

// ── State ────────────────────────────────────────────────────────────────────

let timeRange = { days: 90, from: null, to: null };
let selectedTeam = '';
let currentRoute = 'overview';
let charts = {};
let ganttData = [];
let ganttPage = 1;
let ganttHovered = null;
const GANTT_PER_PAGE = 25;

// ── Utilities ────────────────────────────────────────────────────────────────

function fmt(val, unit) {
  if (val === null || val === undefined) return '—';
  if (unit === 'h') {
    if (val < 1) return `${(val * 60).toFixed(0)}m`;
    if (val < 24) return `${val.toFixed(1)}h`;
    return `${(val / 24).toFixed(1)}d`;
  }
  if (unit === '/day') return val.toFixed(2);
  if (unit === '%') return `${val.toFixed(1)}%`;
  return val.toFixed ? val.toFixed(1) : val;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ratingClass(rating) {
  return { elite: 'badge-elite', high: 'badge-high', medium: 'badge-medium', low: 'badge-low' }[rating] || 'badge-low';
}

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

async function apiFetch(path, opts = {}) {
  const resp = await fetch(path, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showSkeleton(containerId, rows = 3) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array(rows).fill('<div class="skeleton skeleton-text"></div>').join('');
}

// ── Chart defaults ────────────────────────────────────────────────────────────

Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#21262d';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size = 11;

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1c2128',
      borderColor: '#30363d',
      borderWidth: 1,
      titleColor: '#e6edf3',
      bodyColor: '#8b949e',
      padding: 10,
    },
  },
  scales: {
    x: { grid: { color: '#21262d' }, ticks: { maxRotation: 45 } },
    y: { grid: { color: '#21262d' } },
  },
};

// ── Sparkline ────────────────────────────────────────────────────────────────

function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data || !data.length) return;
  destroyChart(canvasId);
  charts[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{ data, borderColor: color, borderWidth: 1.5, pointRadius: 0, fill: true,
        backgroundColor: color.replace(')', ', 0.1)').replace('rgb', 'rgba') }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

// ── Overview Page ─────────────────────────────────────────────────────────────

async function loadOverview() {
  showSkeleton('overview-cards', 4);
  try {
    const qs = getApiParams();
    const data = await apiFetch(`/api/overview${qs}`);

    // DORA cards
    const cards = [
      { key: 'cycle_time', label: 'Cycle Time', val: fmt(data.metrics.cycle_time.median_hours, 'h'), rating: data.metrics.cycle_time.rating, sparkline: data.metrics.cycle_time.sparkline, color: 'rgb(59,130,246)' },
      { key: 'deploy_frequency', label: 'Deploy Freq', val: `${fmt(data.metrics.deploy_frequency.deploys_per_day, '/day')}/day`, rating: data.metrics.deploy_frequency.rating, sparkline: data.metrics.deploy_frequency.sparkline, color: 'rgb(16,185,129)' },
      { key: 'cfr', label: 'Change Failure Rate', val: fmt(data.metrics.cfr.pct, '%'), rating: data.metrics.cfr.rating, sparkline: data.metrics.cfr.sparkline, color: 'rgb(245,158,11)' },
      { key: 'mttr', label: 'MTTR', val: fmt(data.metrics.mttr.median_hours, 'h'), rating: data.metrics.mttr.rating, sparkline: data.metrics.mttr.sparkline, color: 'rgb(168,85,247)' },
    ];

    const grid = document.getElementById('overview-cards');
    grid.innerHTML = cards.map(c => `
      <div class="metric-card">
        <div class="metric-card-header">
          <div class="metric-card-name">${c.label}</div>
          <span class="badge ${ratingClass(c.rating)}">${c.rating}</span>
        </div>
        <div class="metric-value">${c.val}</div>
        <div class="sparkline-container"><canvas id="spark-${c.key}" height="40"></canvas></div>
      </div>
    `).join('');

    cards.forEach(c => drawSparkline(`spark-${c.key}`, c.sparkline, c.color));

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

    // Deploy trend chart
    destroyChart('deploy-trend-chart');
    const deployLabels = data.deploy_trend.map(d => d.week.replace(/W0?/, 'W'));
    const deployData = data.deploy_trend.map(d => d.count);
    charts['deploy-trend-chart'] = new Chart(document.getElementById('deploy-trend-chart'), {
      type: 'bar',
      data: {
        labels: deployLabels,
        datasets: [{ data: deployData, backgroundColor: 'rgba(88,166,255,0.6)', borderColor: '#58a6ff', borderWidth: 1 }],
      },
      options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins } },
    });

    // Recent incidents
    const incDiv = document.getElementById('recent-incidents');
    if (!data.recent_incidents.length) {
      incDiv.innerHTML = '<div class="error-state">No incidents in period</div>';
    } else {
      incDiv.innerHTML = `<table class="data-table"><thead><tr><th>Key</th><th>Summary</th><th>MTTR</th></tr></thead><tbody>
        ${data.recent_incidents.map(i => `
          <tr>
            <td><a href="${i.url}" target="_blank">${i.key}</a></td>
            <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(i.summary)}">${escHtml(i.summary)}</td>
            <td>${fmt(i.mttr_hours, 'h')}</td>
          </tr>
        `).join('')}
      </tbody></table>`;
    }

    // Recent deploys
    const tbody = document.querySelector('#recent-deploys-table tbody');
    tbody.innerHTML = data.recent_deploys.map(d => `
      <tr>
        <td>${d.repo}</td>
        <td><a href="https://github.com/paywithextend/${d.repo}/pull/${d.pr_number}" target="_blank">#${d.pr_number}</a></td>
        <td style="max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(d.title)}</td>
        <td>${d.author}</td>
        <td>${fmtDate(d.merged_at)}</td>
      </tr>
    `).join('');
  } catch (e) {
    document.getElementById('overview-cards').innerHTML = `<div class="error-state"><div class="error-title">Failed to load</div>${e.message}</div>`;
    toast(`Overview error: ${e.message}`, 'error');
  }
}

// ── Cycle Time Page ───────────────────────────────────────────────────────────

async function loadCycleTime() {
  showSkeleton('slowest-prs-table', 5);
  try {
    const data = await apiFetch(`/api/cycle-time${getApiParams()}`);

    const labels = data.trend.map(t => t.week.replace(/W0?/, 'W'));

    destroyChart('ct-trend-chart');
    charts['ct-trend-chart'] = new Chart(document.getElementById('ct-trend-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{ data: data.trend.map(t => t.median_hours), borderColor: '#58a6ff', borderWidth: 2, pointRadius: 3, fill: true, backgroundColor: 'rgba(88,166,255,0.1)', tension: 0.3 }],
      },
      options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, tooltip: { ...CHART_OPTS.plugins.tooltip, callbacks: { label: c => `${fmt(c.raw, 'h')}` } } } },
    });

    destroyChart('ct-phase-chart');
    charts['ct-phase-chart'] = new Chart(document.getElementById('ct-phase-chart'), {
      type: 'bar',
      data: {
        labels: data.phase_breakdown.map(t => t.week.replace(/W0?/, 'W')),
        datasets: [
          { label: 'Coding', data: data.phase_breakdown.map(t => t.coding_hours), backgroundColor: 'rgba(59,130,246,0.8)', stack: 'stack' },
          { label: 'Pickup', data: data.phase_breakdown.map(t => t.pickup_hours), backgroundColor: 'rgba(245,158,11,0.8)', stack: 'stack' },
          { label: 'Review', data: data.phase_breakdown.map(t => t.review_hours), backgroundColor: 'rgba(168,85,247,0.8)', stack: 'stack' },
          { label: 'Deploy', data: data.phase_breakdown.map(t => t.deploy_hours), backgroundColor: 'rgba(16,185,129,0.8)', stack: 'stack' },
        ],
      },
      options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: true, labels: { color: '#8b949e', boxWidth: 12 } } } },
    });

    destroyChart('ct-dist-chart');
    charts['ct-dist-chart'] = new Chart(document.getElementById('ct-dist-chart'), {
      type: 'bar',
      data: {
        labels: data.distribution.map(d => d.bucket),
        datasets: [{ data: data.distribution.map(d => d.count), backgroundColor: 'rgba(88,166,255,0.6)', borderColor: '#58a6ff', borderWidth: 1 }],
      },
      options: { ...CHART_OPTS },
    });

    document.getElementById('slowest-prs-table').innerHTML = '<thead><tr><th>Repo</th><th>PR</th><th>Title</th><th>Hours</th><th>Merged</th></tr></thead><tbody>' + data.slowest_prs.map(pr => `
      <tr>
        <td>${pr.repo}</td>
        <td><a href="https://github.com/paywithextend/${pr.repo}/pull/${pr.pr_number}" target="_blank">#${pr.pr_number}</a></td>
        <td style="max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(pr.title)}</td>
        <td>${fmt(pr.total_hours, 'h')}</td>
        <td>${fmtDate(pr.merged_at)}</td>
      </tr>
    `).join('') + '</tbody>';
  } catch (e) {
    toast(`Cycle time error: ${e.message}`, 'error');
  }
}

// ── Deploys Page ──────────────────────────────────────────────────────────────

async function loadDeploys() {
  showSkeleton('deploy-heatmap', 3);
  try {
    const data = await apiFetch(`/api/deploys${getApiParams()}`);

    destroyChart('deploy-freq-chart');
    charts['deploy-freq-chart'] = new Chart(document.getElementById('deploy-freq-chart'), {
      type: 'line',
      data: {
        labels: data.trend.map(t => t.week.replace(/W0?/, 'W')),
        datasets: [{ data: data.trend.map(t => t.count), borderColor: '#10b981', borderWidth: 2, fill: true, backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.3, pointRadius: 3 }],
      },
      options: { ...CHART_OPTS },
    });

    // Custom heatmap table
    renderHeatmap(data.heatmap);

    const tbody = document.querySelector('#deploys-by-repo tbody');
    tbody.innerHTML = data.by_repo.map(r => `
      <tr>
        <td>${r.repo}</td>
        <td>${r.count}</td>
        <td>${r.avg_files_changed.toFixed(1)}</td>
        <td>${r.avg_additions.toFixed(0)}</td>
      </tr>
    `).join('');

    destroyChart('deploy-size-chart');
    charts['deploy-size-chart'] = new Chart(document.getElementById('deploy-size-chart'), {
      type: 'line',
      data: {
        labels: data.size_trend.map(t => t.week.replace(/W0?/, 'W')),
        datasets: [
          { label: 'Files', data: data.size_trend.map(t => t.avg_files_changed), borderColor: '#58a6ff', borderWidth: 2, tension: 0.3, pointRadius: 2 },
        ],
      },
      options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: true, labels: { color: '#8b949e', boxWidth: 12 } } } },
    });
  } catch (e) {
    toast(`Deploys error: ${e.message}`, 'error');
  }
}

function renderHeatmap(heatmapData) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxCount = Math.max(...heatmapData.map(h => h.count), 1);

  // Build lookup
  const lookup = {};
  for (const h of heatmapData) {
    lookup[`${h.day}-${h.hour}`] = h.count;
  }

  function cellColor(count) {
    if (!count) return '#21262d';
    const pct = count / maxCount;
    if (pct < 0.25) return '#1e4d7b';
    if (pct < 0.5)  return '#1a7abf';
    if (pct < 0.75) return '#2d7dd2';
    return '#58a6ff';
  }

  let html = '<div style="overflow-x:auto"><table class="heatmap-table"><thead><tr><th class="heatmap-label"></th>';
  for (let h = 0; h < 24; h++) {
    html += `<th class="heatmap-label">${h % 6 === 0 ? h + ':00' : ''}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let d = 0; d < 7; d++) {
    html += `<tr><td class="heatmap-label" style="padding-right:6px">${days[d]}</td>`;
    for (let h = 0; h < 24; h++) {
      const count = lookup[`${d}-${h}`] || 0;
      html += `<td class="heatmap-cell" style="background:${cellColor(count)}" title="${days[d]} ${h}:00 — ${count} deploys"></td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  document.getElementById('deploy-heatmap').innerHTML = html;
}

// ── Reliability Page ──────────────────────────────────────────────────────────

async function loadReliability() {
  showSkeleton('incidents-table', 5);

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

  try {
    const data = await apiFetch(`/api/reliability${getApiParams()}`);

    destroyChart('cfr-trend-chart');
    charts['cfr-trend-chart'] = new Chart(document.getElementById('cfr-trend-chart'), {
      type: 'line',
      data: {
        labels: data.cfr_trend.map(t => t.week.replace(/W0?/, 'W')),
        datasets: [{ data: data.cfr_trend.map(t => t.pct), borderColor: '#ef4444', borderWidth: 2, fill: true, backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.3, pointRadius: 3 }],
      },
      options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, tooltip: { ...CHART_OPTS.plugins.tooltip, callbacks: { label: c => `${fmt(c.raw, '%')}` } } } },
    });

    destroyChart('mttr-trend-chart');
    charts['mttr-trend-chart'] = new Chart(document.getElementById('mttr-trend-chart'), {
      type: 'line',
      data: {
        labels: data.mttr_trend.map(t => t.week.replace(/W0?/, 'W')),
        datasets: [{ data: data.mttr_trend.map(t => t.median_hours), borderColor: '#f59e0b', borderWidth: 2, fill: true, backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.3, pointRadius: 3 }],
      },
      options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, tooltip: { ...CHART_OPTS.plugins.tooltip, callbacks: { label: c => `${fmt(c.raw, 'h')}` } } } },
    });

    // Incident timeline bubble chart
    destroyChart('incident-bubble-chart');
    if (data.incidents.length) {
      const repos = [...new Set(data.incidents.map(i => i.repo || i.key.split('-')[0]))];
      const maxMttr = Math.max(...data.incidents.map(i => i.mttr_hours || 0), 1);
      charts['incident-bubble-chart'] = new Chart(document.getElementById('incident-bubble-chart'), {
        type: 'bubble',
        data: {
          datasets: [{
            data: data.incidents.map(i => ({
              x: new Date(i.incident_discovered_at).getTime(),
              y: repos.indexOf(i.repo || i.key.split('-')[0]),
              r: Math.max(5, Math.min(25, (i.mttr_hours || 0) / maxMttr * 25)),
            })),
            backgroundColor: 'rgba(239,68,68,0.6)',
            borderColor: '#ef4444',
          }],
        },
        options: {
          ...CHART_OPTS,
          plugins: { ...CHART_OPTS.plugins, tooltip: { ...CHART_OPTS.plugins.tooltip,
            callbacks: {
              label: ctx => {
                const i = data.incidents[ctx.dataIndex];
                return [`${i.key}: ${i.summary ? i.summary.slice(0, 40) : ''}`, `MTTR: ${fmt(i.mttr_hours, 'h')}`, fmtDate(i.incident_discovered_at)];
              }
            }
          }},
          scales: {
            x: { type: 'linear', grid: { color: '#21262d' }, ticks: { callback: v => fmtDate(new Date(v).toISOString()) } },
            y: { grid: { color: '#21262d' }, ticks: { callback: v => repos[v] || '' }, min: -0.5, max: repos.length - 0.5, stepSize: 1 },
          },
        },
      });
    }

    const incidentRows = !data.incidents.length
      ? '<tr><td colspan="7" style="text-align:center;color:#8b949e">No incidents in period</td></tr>'
      : data.incidents.map(i => `
        <tr>
          <td><a href="${i.url}" target="_blank">${i.key}</a></td>
          <td style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(i.summary)}</td>
          <td>${i.priority || '—'}</td>
          <td>${fmtDate(i.incident_discovered_at)}</td>
          <td>${fmtDate(i.incident_resolved_at)}</td>
          <td>${fmt(i.mttr_hours, 'h')}</td>
          <td>${i.status || '—'}</td>
        </tr>
      `).join('');
    document.getElementById('incidents-table').innerHTML = '<thead><tr><th>Key</th><th>Summary</th><th>Priority</th><th>Discovered</th><th>Resolved</th><th>MTTR</th><th>Status</th></tr></thead><tbody>' + incidentRows + '</tbody>';

    destroyChart('cfr-volume-chart');
    charts['cfr-volume-chart'] = new Chart(document.getElementById('cfr-volume-chart'), {
      type: 'bar',
      data: {
        labels: data.cfr_vs_volume.map(t => t.week.replace(/W0?/, 'W')),
        datasets: [
          { label: 'Deploys', data: data.cfr_vs_volume.map(t => t.deploys), backgroundColor: 'rgba(88,166,255,0.5)', yAxisID: 'y' },
          { label: 'CFR %', data: data.cfr_vs_volume.map(t => t.cfr_pct), type: 'line', borderColor: '#ef4444', borderWidth: 2, pointRadius: 3, yAxisID: 'y1' },
        ],
      },
      options: {
        ...CHART_OPTS,
        plugins: { ...CHART_OPTS.plugins, legend: { display: true, labels: { color: '#8b949e', boxWidth: 12 } } },
        scales: {
          x: { grid: { color: '#21262d' } },
          y: { grid: { color: '#21262d' }, position: 'left' },
          y1: { grid: { display: false }, position: 'right' },
        },
      },
    });
  } catch (e) {
    toast(`Reliability error: ${e.message}`, 'error');
  }
}

// ── PR Deep Dive Page ─────────────────────────────────────────────────────────

async function loadPRDeepDive() {
  showSkeleton('pr-summary-bar', 1);
  const search = document.getElementById('pr-search').value;
  const repo = document.getElementById('pr-repo-filter').value;
  const sort = document.getElementById('pr-sort').value;
  const order = document.getElementById('pr-order').value;

  const qs = getApiParams().replace('?', '');
  const params = new URLSearchParams(qs);
  if (search) params.set('search', search);
  if (repo) params.set('repo', repo);
  params.set('sort', sort);
  params.set('order', order);
  params.set('page', ganttPage);
  params.set('limit', GANTT_PER_PAGE);

  try {
    const data = await apiFetch(`/api/pr-deep-dive?${params}`);
    ganttData = data.prs;

    document.getElementById('pr-summary-bar').textContent =
      `${data.total} PRs · ${data.outlier_count} outliers (>2× median ${fmt(data.org_median_hours, 'h')})`;

    // Populate repo filter if first load
    if (!document.getElementById('pr-repo-filter').children.length > 1) {
      const repos = [...new Set(data.prs.map(p => p.repo))].sort();
      const sel = document.getElementById('pr-repo-filter');
      repos.forEach(r => {
        if (![...sel.options].find(o => o.value === r)) {
          const opt = document.createElement('option');
          opt.value = r; opt.textContent = r;
          sel.appendChild(opt);
        }
      });
    }

    renderGantt(data.prs);
    renderPagination(data.page, data.pages);

    // Scatter: size vs cycle time
    destroyChart('pr-scatter-chart');
    charts['pr-scatter-chart'] = new Chart(document.getElementById('pr-scatter-chart'), {
      type: 'scatter',
      data: {
        datasets: [{
          data: data.prs.map(p => ({ x: p.files_changed, y: p.total_hours })),
          backgroundColor: data.prs.map(p => p.is_outlier ? 'rgba(239,68,68,0.7)' : 'rgba(88,166,255,0.5)'),
          pointRadius: 4,
        }],
      },
      options: {
        ...CHART_OPTS,
        plugins: { ...CHART_OPTS.plugins, tooltip: { ...CHART_OPTS.plugins.tooltip,
          callbacks: {
            label: ctx => {
              const p = data.prs[ctx.dataIndex];
              return [`${p.repo}#${p.pr_number}`, `CT: ${fmt(p.total_hours, 'h')}`, `${p.files_changed} files`];
            }
          }
        }},
        scales: {
          x: { grid: { color: '#21262d' }, title: { display: true, text: 'Files Changed', color: '#8b949e' } },
          y: { grid: { color: '#21262d' }, title: { display: true, text: 'Cycle Time (h)', color: '#8b949e' } },
        },
      },
    });
  } catch (e) {
    toast(`PR Deep Dive error: ${e.message}`, 'error');
  }
}

function renderGantt(prList) {
  const canvas = document.getElementById('gantt-canvas');
  if (!canvas) return;

  const ROW_H = 28;
  const LABEL_W = 160;
  const BAR_Y_PAD = 6;
  const H = prList.length * ROW_H + 40;
  canvas.width = canvas.parentElement.clientWidth || 800;
  canvas.height = H;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!prList.length) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('No PRs to display', LABEL_W + 20, 30);
    return;
  }

  // Find time range for x-axis
  const dates = prList.flatMap(p => [new Date(p.first_commit_at), new Date(p.merged_at)]);
  const minTime = Math.min(...dates.map(d => d.getTime()));
  const maxTime = Math.max(...dates.map(d => d.getTime()));
  const timeSpan = maxTime - minTime || 86400000;
  const chartW = canvas.width - LABEL_W - 20;

  function toX(iso) {
    const t = new Date(iso).getTime();
    return LABEL_W + ((t - minTime) / timeSpan) * chartW;
  }

  // Colors per phase
  const phaseColors = {
    coding: '#3b82f6',
    pickup: '#f59e0b',
    review: '#a855f7',
    deploy: '#10b981',
  };

  ganttHovered = null;
  canvas._prList = prList;
  canvas._toX = toX;
  canvas._LABEL_W = LABEL_W;
  canvas._ROW_H = ROW_H;
  canvas._BAR_Y_PAD = BAR_Y_PAD;
  canvas._phaseColors = phaseColors;
  canvas._minTime = minTime;
  canvas._timeSpan = timeSpan;
  canvas._chartW = chartW;

  prList.forEach((pr, i) => {
    const y = 30 + i * ROW_H;
    const barY = y + BAR_Y_PAD;
    const barH = ROW_H - BAR_Y_PAD * 2;

    // Draw row background
    if (pr.is_outlier) {
      ctx.fillStyle = 'rgba(239,68,68,0.05)';
      ctx.fillRect(0, y, canvas.width, ROW_H);
    }

    // Label
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    const label = `${pr.repo}#${pr.pr_number}`;
    ctx.fillText(label.slice(0, 24), LABEL_W - 6, y + ROW_H / 2 + 4);
    ctx.textAlign = 'left';

    // Phases: coding (first_commit → created), pickup (created → first_review), review (first_review → approved), deploy (approved → merged)
    const phases = [
      { start: pr.first_commit_at, end: pr.created_at, color: phaseColors.coding },
      { start: pr.created_at, end: pr.first_review_at || pr.merged_at, color: phaseColors.pickup },
      ...(pr.first_review_at ? [{ start: pr.first_review_at, end: pr.approved_at || pr.merged_at, color: phaseColors.review }] : []),
      ...(pr.approved_at ? [{ start: pr.approved_at, end: pr.merged_at, color: phaseColors.deploy }] : []),
    ];

    for (const phase of phases) {
      if (!phase.start || !phase.end) continue;
      const x1 = toX(phase.start);
      const x2 = toX(phase.end);
      const w = Math.max(x2 - x1, 2);
      ctx.fillStyle = phase.color;
      ctx.fillRect(x1, barY, w, barH);
    }

    // Outlier indicator
    if (pr.is_outlier) {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(canvas.width - 8, barY, 4, barH);
    }
  });

  // X-axis labels (dates)
  ctx.fillStyle = '#6e7681';
  ctx.font = '10px Inter, sans-serif';
  const nTicks = 5;
  for (let t = 0; t <= nTicks; t++) {
    const ts = minTime + (timeSpan / nTicks) * t;
    const x = LABEL_W + (chartW / nTicks) * t;
    const d = new Date(ts);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, x - 12, 18);
  }

  // Mouse tooltip
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = Math.floor((my - 30) / ROW_H);
    const pr = prList[idx];
    if (!pr) {
      document.getElementById('pr-detail-panel').style.display = 'none';
      return;
    }
    canvas.style.cursor = 'pointer';
  };

  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const my = e.clientY - rect.top;
    const idx = Math.floor((my - 30) / ROW_H);
    const pr = prList[idx];
    if (!pr) return;
    showPRDetail(pr);
  };
}

function showPRDetail(pr) {
  const panel = document.getElementById('pr-detail-panel');
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <div>
        <div style="font-size:0.875rem;font-weight:600;color:#e6edf3">${escHtml(pr.title)}</div>
        <div style="font-size:0.75rem;color:#8b949e;margin-top:4px">${pr.repo} · ${pr.author} · <a href="${pr.github_url}" target="_blank">#${pr.pr_number}</a></div>
      </div>
      <span class="badge ${pr.is_outlier ? 'badge-low' : 'badge-high'}">${pr.is_outlier ? 'Outlier' : 'Normal'}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;font-size:0.8rem">
      <div><div style="color:#8b949e">Total</div><div style="font-weight:600;color:#e6edf3">${fmt(pr.total_hours, 'h')}</div></div>
      <div><div style="color:#3b82f6">Coding</div><div style="font-weight:600">${fmt(pr.coding_hours, 'h')}</div></div>
      <div><div style="color:#f59e0b">Pickup</div><div style="font-weight:600">${fmt(pr.pickup_hours, 'h')}</div></div>
      <div><div style="color:#a855f7">Review</div><div style="font-weight:600">${fmt(pr.review_hours, 'h')}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;font-size:0.8rem;margin-top:8px">
      <div><div style="color:#10b981">Deploy</div><div style="font-weight:600">${fmt(pr.deploy_hours, 'h')}</div></div>
      <div><div style="color:#8b949e">Reviews</div><div style="font-weight:600">${pr.review_count}</div></div>
      <div><div style="color:#8b949e">Files</div><div style="font-weight:600">${pr.files_changed}</div></div>
      <div><div style="color:#8b949e">Merged</div><div style="font-weight:600">${fmtDate(pr.merged_at)}</div></div>
    </div>
  `;
}

function renderPagination(page, pages) {
  const container = document.getElementById('pr-pagination');
  if (pages <= 1) { container.innerHTML = ''; return; }
  let html = '';
  if (page > 1) html += `<button class="page-btn" onclick="changePage(${page - 1})">←</button>`;
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, page + 2);
  for (let p = start; p <= end; p++) {
    html += `<button class="page-btn${p === page ? ' active' : ''}" onclick="changePage(${p})">${p}</button>`;
  }
  if (page < pages) html += `<button class="page-btn" onclick="changePage(${page + 1})">→</button>`;
  html += `<span class="page-info">${page} of ${pages}</span>`;
  container.innerHTML = html;
}

function changePage(p) {
  ganttPage = p;
  loadPRDeepDive();
}

// ── Goals Page ────────────────────────────────────────────────────────────────

async function loadGoals() {
  showSkeleton('goals-form', 4);
  try {
    const [goalsData, statusData] = await Promise.all([
      apiFetch('/api/goals'),
      apiFetch(`/api/goals/status${getApiParams()}`),
    ]);

    // Goals form
    const metricDefs = [
      { key: 'cycle_time_hours', label: 'Cycle Time Target (hours)', min: 0.1 },
      { key: 'deploys_per_day', label: 'Deploy Frequency Target (/day)', min: 0.01 },
      { key: 'cfr_pct', label: 'Change Failure Rate Target (%)', min: 0.1 },
      { key: 'mttr_hours', label: 'MTTR Target (hours)', min: 0.1 },
    ];

    document.getElementById('goals-form').innerHTML = metricDefs.map(m => `
      <div class="goal-item">
        <div class="goal-label">${m.label}</div>
        <div class="goal-input-row">
          <input class="goal-input" id="goal-${m.key}" type="number" step="0.1" min="${m.min}" value="${goalsData[m.key]}">
          <span style="font-size:0.7rem;color:#8b949e">${m.key === 'deploys_per_day' ? '/day' : m.key.includes('pct') ? '%' : 'h'}</span>
        </div>
        <div id="goal-input-err-${m.key}" style="font-size:0.7rem;color:#ef4444;min-height:14px"></div>
      </div>
    `).join('');

    // Gauges
    const metrics = [
      { key: 'cycle_time', label: 'Cycle Time', m: statusData.metrics.cycle_time },
      { key: 'deploy_frequency', label: 'Deploy Frequency', m: statusData.metrics.deploy_frequency },
      { key: 'cfr', label: 'CFR', m: statusData.metrics.cfr },
      { key: 'mttr', label: 'MTTR', m: statusData.metrics.mttr },
    ];

    document.getElementById('goal-gauges').innerHTML = metrics.map(({ key, label, m }) => `
      <div class="metric-card">
        <div class="metric-card-header">
          <div class="metric-card-name">${label}</div>
          ${m.meeting_goal
            ? '<span class="badge badge-elite">On Target</span>'
            : '<span class="badge badge-low">Off Target</span>'}
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <canvas id="gauge-${key}" width="80" height="80"></canvas>
          <div>
            <div class="metric-value" style="font-size:1.2rem">${m.pct_of_target !== null ? m.pct_of_target.toFixed(0) : '—'}%</div>
            <div style="font-size:0.7rem;color:#8b949e">of target</div>
          </div>
        </div>
      </div>
    `).join('');

    metrics.forEach(({ key, m }) => drawGauge(`gauge-${key}`, m.pct_of_target, m.meeting_goal));

    // Deltas
    const deltas = statusData.weekly_deltas;
    document.getElementById('goal-deltas').innerHTML = ['cycle_time', 'deploy_frequency', 'cfr', 'mttr'].map(k => {
      const d = deltas[k];
      if (!d) return '';
      const improved = d.improved;
      const arrow = d.delta_pct === null ? '' : (d.delta_pct > 0 ? '↑' : '↓');
      const cls = improved === null ? 'delta-neutral' : (improved ? 'delta-up' : 'delta-down');
      return `
        <div class="delta-card">
          <div class="delta-title">${k.replace(/_/g, ' ')}</div>
          <div class="delta-value">${d.current !== null ? d.current.toFixed(2) : '—'}</div>
          <div class="delta-change ${cls}">${arrow} ${d.delta_pct !== null ? Math.abs(d.delta_pct).toFixed(1) + '%' : '—'} vs prev period</div>
        </div>
      `;
    }).join('');

    // Trend chart
    destroyChart('goal-trend-chart');
    if (statusData.goal_trend.length) {
      const weeks = statusData.goal_trend.map(t => t.week.replace(/W0?/, 'W'));
      charts['goal-trend-chart'] = new Chart(document.getElementById('goal-trend-chart'), {
        type: 'line',
        data: {
          labels: weeks,
          datasets: [
            { label: 'Cycle Time', data: statusData.goal_trend.map(t => t.cycle_time_hours), borderColor: '#58a6ff', borderWidth: 2, tension: 0.3, pointRadius: 2 },
            { label: 'CT Target', data: weeks.map(() => goalsData.cycle_time_hours), borderColor: '#58a6ff', borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
          ],
        },
        options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: true, labels: { color: '#8b949e', boxWidth: 12 } } } },
      });
    }
  } catch (e) {
    toast(`Goals error: ${e.message}`, 'error');
  }
}

function drawGauge(canvasId, pct, meetingGoal) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = 40, cy = 40, r = 30;
  ctx.clearRect(0, 0, 80, 80);

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 8;
  ctx.stroke();

  // Value arc
  const pctClamped = Math.min(Math.max(pct || 0, 0), 200) / 200;
  const startAngle = Math.PI * 0.75;
  const endAngle = startAngle + pctClamped * Math.PI * 1.5;
  const color = meetingGoal ? '#10b981' : (pct > 120 ? '#ef4444' : '#f59e0b');
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.stroke();
}

async function saveGoals() {
  const keys = ['cycle_time_hours', 'deploys_per_day', 'cfr_pct', 'mttr_hours'];
  const body = {};
  let valid = true;

  for (const k of keys) {
    const val = parseFloat(document.getElementById(`goal-${k}`)?.value);
    const errEl = document.getElementById(`goal-input-err-${k}`);
    if (isNaN(val) || val <= 0) {
      if (errEl) errEl.textContent = 'Must be a positive number';
      valid = false;
    } else {
      if (errEl) errEl.textContent = '';
      body[k] = val;
    }
  }

  if (!valid) return;

  try {
    const resp = await fetch('/api/goals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    toast('Goals saved', 'success');
    loadGoals();
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error');
  }
}

// ── Advanced Page ─────────────────────────────────────────────────────────────

async function loadAdvanced() {
  showSkeleton('cal-heatmap', 3);
  try {
    const qs = getApiParams();
    const [calData, flowData, corrData, radarData, digestData] = await Promise.all([
      apiFetch(`/api/reports/calendar${qs}`),
      apiFetch(`/api/reports/flow${qs}`),
      apiFetch(`/api/reports/incident-correlation${qs}`),
      apiFetch(`/api/reports/radar${qs}`),
      apiFetch(`/api/reports/digest${qs}`),
    ]);

    renderCalendarHeatmap(calData.days);

    // Cumulative flow
    destroyChart('flow-chart');
    charts['flow-chart'] = new Chart(document.getElementById('flow-chart'), {
      type: 'line',
      data: {
        labels: flowData.weeks.map(w => w.week.replace(/W0?/, 'W')),
        datasets: [
          { label: 'Coding', data: flowData.weeks.map(w => w.coding), borderColor: '#3b82f6', borderWidth: 2, fill: true, backgroundColor: 'rgba(59,130,246,0.3)', stack: 'flow', tension: 0.3 },
          { label: 'In Review', data: flowData.weeks.map(w => w.in_review), borderColor: '#a855f7', borderWidth: 2, fill: true, backgroundColor: 'rgba(168,85,247,0.3)', stack: 'flow', tension: 0.3 },
          { label: 'Merged', data: flowData.weeks.map(w => w.merged), borderColor: '#10b981', borderWidth: 2, fill: true, backgroundColor: 'rgba(16,185,129,0.3)', stack: 'flow', tension: 0.3 },
        ],
      },
      options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: true, labels: { color: '#8b949e', boxWidth: 12 } } } },
    });

    // Throughput vs WIP
    destroyChart('throughput-chart');
    charts['throughput-chart'] = new Chart(document.getElementById('throughput-chart'), {
      type: 'bar',
      data: {
        labels: flowData.weeks.map(w => w.week.replace(/W0?/, 'W')),
        datasets: [
          { label: 'Merged', data: flowData.weeks.map(w => w.merged), backgroundColor: 'rgba(16,185,129,0.7)', yAxisID: 'y' },
          { label: 'WIP', type: 'line', data: flowData.weeks.map(w => w.total_open), borderColor: '#f59e0b', borderWidth: 2, pointRadius: 3, yAxisID: 'y1' },
        ],
      },
      options: {
        ...CHART_OPTS,
        plugins: { ...CHART_OPTS.plugins, legend: { display: true, labels: { color: '#8b949e', boxWidth: 12 } } },
        scales: {
          x: { grid: { color: '#21262d' } },
          y: { grid: { color: '#21262d' }, position: 'left' },
          y1: { grid: { display: false }, position: 'right' },
        },
      },
    });

    // Incident correlation table
    const tbody = document.querySelector('#correlation-table tbody');
    if (!corrData.correlations.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#8b949e">No incidents in period</td></tr>';
    } else {
      tbody.innerHTML = corrData.correlations.map(c => `
        <tr>
          <td><a href="https://paywithextend.atlassian.net/browse/${c.incident_key}" target="_blank">${c.incident_key}</a></td>
          <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c.incident_summary)}</td>
          <td>${fmtDate(c.incident_discovered_at)}</td>
          <td>${c.suspected_pr ? `<a href="${c.suspected_pr.github_url}" target="_blank">${c.suspected_pr.repo}#${c.suspected_pr.pr_number}</a> — ${escHtml(c.suspected_pr.title).slice(0, 40)}` : '—'}</td>
          <td>${c.suspected_pr ? fmt(c.suspected_pr.hours_before_incident, 'h') : '—'}</td>
        </tr>
      `).join('');
    }

    // Radar chart
    destroyChart('radar-chart');
    charts['radar-chart'] = new Chart(document.getElementById('radar-chart'), {
      type: 'radar',
      data: {
        labels: ['Cycle Time', 'Deploy Freq', 'CFR', 'MTTR'],
        datasets: [
          { label: 'Current', data: [radarData.current.cycle_time, radarData.current.deploy_frequency, radarData.current.cfr, radarData.current.mttr], borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.2)', borderWidth: 2, pointRadius: 4 },
          { label: 'Previous', data: [radarData.previous.cycle_time, radarData.previous.deploy_frequency, radarData.previous.cfr, radarData.previous.mttr], borderColor: '#8b949e', backgroundColor: 'transparent', borderWidth: 1, borderDash: [4, 4], pointRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: '#8b949e' } }, tooltip: { backgroundColor: '#1c2128', borderColor: '#30363d', borderWidth: 1 } },
        scales: { r: { min: 0, max: 100, grid: { color: '#30363d' }, angleLines: { color: '#30363d' }, ticks: { display: false }, pointLabels: { color: '#8b949e', font: { size: 11 } } } },
      },
    });

    // Weekly digest
    renderDigest(digestData);
  } catch (e) {
    toast(`Advanced error: ${e.message}`, 'error');
  }
}

function renderCalendarHeatmap(days) {
  const container = document.getElementById('cal-heatmap');
  if (!days.length) { container.innerHTML = '<div class="error-state">No deploys in period</div>'; return; }

  const lookup = {};
  let maxCount = 0;
  for (const d of days) {
    lookup[d.date] = d.count;
    maxCount = Math.max(maxCount, d.count);
  }

  const firstDate = new Date(days[0].date);
  const lastDate = new Date(days[days.length - 1].date);

  // Expand to full weeks
  const startDate = new Date(firstDate);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // start of week (Sun)
  const endDate = new Date(lastDate);
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // end of week (Sat)

  const CELL_SIZE = 12, GAP = 2;
  const weeks = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }

  function cellColor(date) {
    const iso = date.toISOString().slice(0, 10);
    const count = lookup[iso] || 0;
    if (!count) return '#21262d';
    if (count === 1) return '#0e4429';
    if (count <= 3) return '#006d32';
    return '#26a641';
  }

  const svgW = weeks.length * (CELL_SIZE + GAP) + 30;
  const svgH = 7 * (CELL_SIZE + GAP) + 30;
  let svg = `<svg width="${svgW}" height="${svgH}" style="font-family:Inter,sans-serif">`;

  // Month labels
  let prevMonth = -1;
  weeks.forEach((week, wi) => {
    const month = week[0].getMonth();
    if (month !== prevMonth) {
      prevMonth = month;
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const x = wi * (CELL_SIZE + GAP) + 30;
      svg += `<text x="${x}" y="12" font-size="10" fill="#6e7681">${monthNames[month]}</text>`;
    }
  });

  // Day labels (Mon, Wed, Fri)
  const dayLabels = ['', 'M', '', 'W', '', 'F', ''];
  for (let d = 0; d < 7; d++) {
    const y = 20 + d * (CELL_SIZE + GAP) + CELL_SIZE;
    svg += `<text x="0" y="${y}" font-size="9" fill="#6e7681">${dayLabels[d]}</text>`;
  }

  // Cells
  weeks.forEach((week, wi) => {
    week.forEach((date, di) => {
      const x = 28 + wi * (CELL_SIZE + GAP);
      const y = 18 + di * (CELL_SIZE + GAP);
      const color = cellColor(date);
      const iso = date.toISOString().slice(0, 10);
      const count = lookup[iso] || 0;
      svg += `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="2" fill="${color}">
        <title>${iso}: ${count} deploy${count !== 1 ? 's' : ''}</title></rect>`;
    });
  });

  svg += '</svg>';
  container.innerHTML = svg;
}

function renderDigest(data) {
  const m = data.metrics;
  document.getElementById('digest-card').innerHTML = `
    <div class="digest-card">
      <div style="font-size:0.75rem;color:#8b949e;margin-bottom:12px">${data.period.from} — ${data.period.to}</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px">
        ${[
          { label: 'Cycle Time', val: fmt(m.cycle_time.median_hours, 'h'), r: m.cycle_time.rating, d: m.cycle_time.delta_pct, improved: m.cycle_time.improved, lower: true },
          { label: 'Deploy Freq', val: `${fmt(m.deploy_frequency.deploys_per_day, '/day')}/d`, r: m.deploy_frequency.rating, d: m.deploy_frequency.delta_pct, improved: m.deploy_frequency.improved, lower: false },
          { label: 'CFR', val: fmt(m.cfr.pct, '%'), r: m.cfr.rating, d: m.cfr.delta_pct, improved: m.cfr.improved, lower: true },
          { label: 'MTTR', val: fmt(m.mttr.median_hours, 'h'), r: m.mttr.rating, d: m.mttr.delta_pct, improved: m.mttr.improved, lower: true },
        ].map(item => `
          <div style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px">
            <div style="font-size:0.7rem;color:#8b949e;margin-bottom:4px">${item.label}</div>
            <div style="font-size:1.2rem;font-weight:700;color:#e6edf3">${item.val}</div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
              <span class="badge ${ratingClass(item.r)}">${item.r}</span>
              ${item.d !== null ? `<span style="font-size:0.7rem;color:${item.improved ? '#10b981' : '#ef4444'}">${item.d > 0 ? '↑' : '↓'}${Math.abs(item.d).toFixed(1)}%</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      ${data.achievements.length ? `
        <div style="margin-bottom:8px;font-size:0.75rem;font-weight:600;color:#10b981">Achievements</div>
        ${data.achievements.map(a => `<div class="digest-achievement"><span class="ach-icon">✓</span><span>${a}</span></div>`).join('')}
      ` : ''}
      ${data.concerns.length ? `
        <div style="margin:8px 0 8px;font-size:0.75rem;font-weight:600;color:#ef4444">Concerns</div>
        ${data.concerns.map(c => `<div class="digest-achievement"><span class="con-icon">!</span><span>${c}</span></div>`).join('')}
      ` : ''}
    </div>
  `;
}

// ── Routing ───────────────────────────────────────────────────────────────────

const PAGE_TITLES = {
  overview: 'Overview',
  'cycle-time': 'Cycle Time',
  deploys: 'Deploys',
  reliability: 'Reliability',
  'pr-deep-dive': 'PR Deep Dive',
  goals: 'Goals & Targets',
  reports: 'Advanced Reporting',
};

const PAGE_LOADERS = {
  overview: loadOverview,
  'cycle-time': loadCycleTime,
  deploys: loadDeploys,
  reliability: loadReliability,
  'pr-deep-dive': loadPRDeepDive,
  goals: loadGoals,
  reports: loadAdvanced,
};

function navigate(route) {
  if (!PAGE_TITLES[route]) route = 'overview';
  currentRoute = route;

  // Update active page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`page-${route}`);
  if (pageEl) pageEl.classList.add('active');

  // Update nav
  document.querySelectorAll('#sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });

  document.getElementById('page-title').textContent = PAGE_TITLES[route] || route;

  // Load data
  if (PAGE_LOADERS[route]) PAGE_LOADERS[route]();
}

function handleHashChange() {
  const hash = window.location.hash;
  const route = hash.replace('#/', '') || 'overview';
  navigate(route);
}

window.addEventListener('hashchange', handleHashChange);

// ── Time range picker ─────────────────────────────────────────────────────────

document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const days = btn.dataset.days;
    if (days === 'all') {
      timeRange = { days: 'all', from: null, to: null };
    } else {
      timeRange = { days: parseInt(days), from: null, to: null };
    }
    document.getElementById('date-from').value = '';
    document.getElementById('date-to').value = '';
    if (PAGE_LOADERS[currentRoute]) PAGE_LOADERS[currentRoute]();
  });
});

document.getElementById('date-from').addEventListener('change', applyCustomRange);
document.getElementById('date-to').addEventListener('change', applyCustomRange);

function applyCustomRange() {
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  if (from && to) {
    timeRange = { days: null, from, to };
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    if (PAGE_LOADERS[currentRoute]) PAGE_LOADERS[currentRoute]();
  }
}

// ── Refresh button ────────────────────────────────────────────────────────────

document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spin">↺</span> Refreshing...';
  toast('Refreshing data...', 'info');

  try {
    const data = await apiFetch('/api/refresh', { method: 'POST' });
    toast(`Data refreshed: ${data.prs} PRs, ${data.incidents} incidents`, 'success');
    document.getElementById('last-refresh').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    if (PAGE_LOADERS[currentRoute]) PAGE_LOADERS[currentRoute]();
  } catch (e) {
    toast(`Refresh failed: ${e.message}`, 'error');
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh';
  }
});

// ── Goals save button ─────────────────────────────────────────────────────────

document.getElementById('save-goals-btn')?.addEventListener('click', saveGoals);

// ── PR Deep Dive filters ──────────────────────────────────────────────────────

let searchTimeout;
['pr-search', 'pr-repo-filter', 'pr-sort', 'pr-order'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => { ganttPage = 1; loadPRDeepDive(); });
});
document.getElementById('pr-search')?.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { ganttPage = 1; loadPRDeepDive(); }, 300);
});

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

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

let kbdBuffer = '';
let kbdTimeout;

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === '?') {
    const modal = document.getElementById('kbd-modal');
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  if (e.key === 'Escape') {
    document.getElementById('kbd-modal').style.display = 'none';
    return;
  }

  kbdBuffer += e.key.toLowerCase();
  clearTimeout(kbdTimeout);
  kbdTimeout = setTimeout(() => { kbdBuffer = ''; }, 1000);

  const shortcuts = {
    'go': 'overview',
    'gc': 'cycle-time',
    'gd': 'deploys',
    'gr': 'reliability',
    'gp': 'pr-deep-dive',
    'gg': 'goals',
    'ga': 'reports',
  };

  if (shortcuts[kbdBuffer]) {
    window.location.hash = `#/${shortcuts[kbdBuffer]}`;
    kbdBuffer = '';
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Expose for onclick handlers
window.changePage = changePage;

// ── Init ──────────────────────────────────────────────────────────────────────

// Load and display current user
(async () => {
  try {
    const user = await apiFetch('/auth/user');
    document.getElementById('user-email').textContent = user.email;
    document.getElementById('user-info').style.display = '';
  } catch (e) {
    // Not authenticated — server-side redirect handles this,
    // but as a fallback redirect to login
    window.location.href = '/auth/google';
  }
})();

// Load team dropdown (async, doesn't block page load)
initTeamFilter();

// Default route
if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
  window.location.hash = '#/overview';
} else {
  handleHashChange();
}
