'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = 3000;
const TRANSACTIONS_FILE = path.join(__dirname, 'data', 'transactions.json');
const TRIAGE_FILE = path.join(__dirname, 'data', 'triage.json');

app.use(express.json());
app.use(express.static('public'));

// ─── Global state ──────────────────────────────────────────────────────────────
let transactions = [];       // normalized
let outlierMap = {};         // txn_id → outliers[]
let triageState = {};        // txn_id → { status, updated_at }
let cardholderStats = {};    // cardholder → { mean, stddev, median, avg_daily_spend, active_day_count, daily_spend, transaction_count }
let categoryTotals = {};     // mcc_group → total_spend_cents
let firstMerchantTxns = new Set(); // txn ids that are first from this merchant for this cardholder

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function stddev(arr, mean) {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// ─── Normalization ─────────────────────────────────────────────────────────────
function normalize(raw) {
  return {
    id: raw.id,
    merchant: raw.merchantName || 'Unknown',
    amount_cents: raw.authBillingAmountCents ?? 0,
    date: raw.authedAt || null,
    virtual_card_id: raw.virtualCardId || null,
    vcn_display_name: raw.vcnDisplayName || '',
    vcn_last4: raw.vcnLast4 || '',
    cardholder: raw.recipientName || raw.cardholderName || 'Unknown',
    mcc: raw.mcc || 'UNKNOWN',
    mcc_group: raw.mccGroup || raw.mccGroupKey || 'OTHER',
    receipt_missing: !raw.hasAttachments || (raw.attachmentsCount === 0),
    status: raw.status || 'UNKNOWN',
  };
}

// ─── Baselines ─────────────────────────────────────────────────────────────────
function computeBaselines(txns) {
  // Only CLEARED and PENDING for baselines/spend
  const active = txns.filter(t => t.status === 'CLEARED' || t.status === 'PENDING');

  // Per-cardholder groups
  const chGroups = {};
  for (const t of active) {
    if (!chGroups[t.cardholder]) chGroups[t.cardholder] = [];
    chGroups[t.cardholder].push(t);
  }

  // Per-category totals
  categoryTotals = {};
  for (const t of active) {
    categoryTotals[t.mcc_group] = (categoryTotals[t.mcc_group] || 0) + t.amount_cents;
  }

  // Per-cardholder stats
  cardholderStats = {};
  for (const [ch, ctxns] of Object.entries(chGroups)) {
    const amounts = ctxns.map(t => t.amount_cents);
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const sd = stddev(amounts, mean);
    const med = median(amounts);

    const dailySpend = {};
    for (const t of ctxns) {
      if (!t.date) continue;
      const dk = t.date.substring(0, 10);
      dailySpend[dk] = (dailySpend[dk] || 0) + t.amount_cents;
    }
    const activeDayCount = Object.keys(dailySpend).length;
    const avgDailySpend = activeDayCount > 0
      ? Object.values(dailySpend).reduce((s, v) => s + v, 0) / activeDayCount
      : 0;

    cardholderStats[ch] = {
      mean,
      stddev: sd,
      median: med,
      avg_daily_spend: avgDailySpend,
      active_day_count: activeDayCount,
      daily_spend: dailySpend,
      transaction_count: ctxns.length,
    };
  }

  // First-merchant tracking (in date order)
  firstMerchantTxns = new Set();
  const sortedActive = [...active]
    .filter(t => t.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const seen = {};
  for (const t of sortedActive) {
    if (!seen[t.cardholder]) seen[t.cardholder] = new Set();
    if (!seen[t.cardholder].has(t.merchant)) {
      firstMerchantTxns.add(t.id);
    }
    seen[t.cardholder].add(t.merchant);
  }
}

// ─── Outlier detection ─────────────────────────────────────────────────────────
function detectOutliers(txns) {
  outlierMap = {};
  for (const t of txns) {
    if (t.status === 'DECLINED' || t.status === 'NO_MATCH') continue;
    if (t.amount_cents === 0) continue;

    const outliers = [];
    const stats = cardholderStats[t.cardholder];

    // AMOUNT_OUTLIER
    if (stats && stats.transaction_count >= 5) {
      const threshold = stats.mean + 2 * stats.stddev;
      if (t.amount_cents > threshold && stats.mean > 0) {
        const ratio = (t.amount_cents / stats.mean).toFixed(1);
        outliers.push({
          rule_id: 'AMOUNT_OUTLIER',
          severity: 'HIGH',
          description: 'Unusual amount for this cardholder',
          context: `This transaction (${fmt$(t.amount_cents)}) is ${ratio}x the cardholder's average (${fmt$(stats.mean)})`,
        });
      }
    }

    // CATEGORY_SPIKE
    const catTotal = categoryTotals[t.mcc_group] || 0;
    if (catTotal > 0 && t.amount_cents > 0.5 * catTotal) {
      const pct = ((t.amount_cents / catTotal) * 100).toFixed(1);
      outliers.push({
        rule_id: 'CATEGORY_SPIKE',
        severity: 'HIGH',
        description: 'Category spike',
        context: `This transaction is ${pct}% of all ${t.mcc_group} spend (${fmt$(catTotal)} total)`,
      });
    }

    // VELOCITY_SPIKE
    if (stats && stats.active_day_count >= 3 && t.date && stats.avg_daily_spend > 0) {
      const dk = t.date.substring(0, 10);
      const dailyTotal = stats.daily_spend[dk] || 0;
      if (dailyTotal > 3 * stats.avg_daily_spend) {
        const ratio = (dailyTotal / stats.avg_daily_spend).toFixed(1);
        outliers.push({
          rule_id: 'VELOCITY_SPIKE',
          severity: 'MEDIUM',
          description: 'Spending velocity spike',
          context: `Daily spend of ${fmt$(dailyTotal)} is ${ratio}x the cardholder's average daily spend (${fmt$(stats.avg_daily_spend)})`,
        });
      }
    }

    // NEW_MERCHANT
    if (firstMerchantTxns.has(t.id) && t.amount_cents > 10000) {
      outliers.push({
        rule_id: 'NEW_MERCHANT',
        severity: 'MEDIUM',
        description: 'New merchant, large amount',
        context: `First purchase from ${t.merchant} by ${t.cardholder} — ${fmt$(t.amount_cents)}`,
      });
    }

    // WEEKEND_LARGE
    if (t.date && stats && stats.median > 0) {
      const dow = new Date(t.date).getDay();
      if ((dow === 0 || dow === 6) && t.amount_cents > stats.median) {
        outliers.push({
          rule_id: 'WEEKEND_LARGE',
          severity: 'LOW',
          description: 'Large weekend transaction',
          context: `Weekend transaction of ${fmt$(t.amount_cents)} exceeds median of ${fmt$(stats.median)}`,
        });
      }
    }

    // MISSING_RECEIPT_HIGH
    if (t.receipt_missing && t.amount_cents > 5000) {
      outliers.push({
        rule_id: 'MISSING_RECEIPT_HIGH',
        severity: 'HIGH',
        description: 'Missing receipt, high value',
        context: `No receipt attached for ${fmt$(t.amount_cents)} transaction`,
      });
    }

    if (outliers.length > 0) {
      outlierMap[t.id] = outliers;
    }
  }
}

// ─── Triage helpers ────────────────────────────────────────────────────────────
function loadTriage() {
  try {
    if (fs.existsSync(TRIAGE_FILE)) {
      triageState = JSON.parse(fs.readFileSync(TRIAGE_FILE, 'utf8'));
    } else {
      triageState = {};
      fs.writeFileSync(TRIAGE_FILE, '{}', 'utf8');
    }
  } catch (e) {
    console.error('Error loading triage.json:', e.message);
    triageState = {};
  }
}

function saveTriage() {
  fs.writeFileSync(TRIAGE_FILE, JSON.stringify(triageState, null, 2), 'utf8');
}

function getTriageStatus(txnId) {
  const hasOutliers = (outlierMap[txnId] || []).length > 0;
  if (!hasOutliers) return null;
  return triageState[txnId]?.status || 'flagged';
}

function enrichTransaction(t) {
  const outliers = outlierMap[t.id] || [];
  const triage_status = getTriageStatus(t.id);
  return { ...t, outliers, triage_status, triage_updated_at: triageState[t.id]?.updated_at || null };
}

// ─── Date filtering ────────────────────────────────────────────────────────────
function filterByDate(txns, from, to) {
  return txns.filter(t => {
    if (!t.date) return false;
    const d = t.date.substring(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// ─── Counts ───────────────────────────────────────────────────────────────────
function getCounts(txns) {
  let flagged = 0, acknowledged = 0, investigating = 0;
  for (const t of txns) {
    const status = getTriageStatus(t.id);
    if (status === 'flagged') flagged++;
    else if (status === 'acknowledged') acknowledged++;
    else if (status === 'investigating') investigating++;
  }
  return { flagged, acknowledged, investigating, all: txns.length };
}

// ─── Sparklines ───────────────────────────────────────────────────────────────
function computeSparklines(txns, to) {
  const endDate = to ? new Date(to + 'T00:00:00Z') : new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().substring(0, 10));
  }
  const byDay = {};
  for (const t of txns) {
    if (!t.date) continue;
    const dk = t.date.substring(0, 10);
    if (!byDay[dk]) byDay[dk] = [];
    byDay[dk].push(t);
  }
  const spend = days.map(d => (byDay[d] || []).reduce((s, t) => s + t.amount_cents, 0));
  const count = days.map(d => (byDay[d] || []).length);
  const outliers = days.map(d => (byDay[d] || []).filter(t => (outlierMap[t.id] || []).length > 0).length);
  const avg = days.map((d, i) => count[i] > 0 ? Math.round(spend[i] / count[i]) : 0);
  return { spend, count, outliers, avg };
}

// ─── Category sparkline ────────────────────────────────────────────────────────
function computeCategorySparkline(mcc_group, txns, to) {
  const endDate = to ? new Date(to + 'T00:00:00Z') : new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().substring(0, 10));
  }
  const byDay = {};
  for (const t of txns) {
    if (t.mcc_group !== mcc_group || !t.date) continue;
    const dk = t.date.substring(0, 10);
    byDay[dk] = (byDay[dk] || 0) + t.amount_cents;
  }
  return days.map(d => byDay[d] || 0);
}

// ─── Period stats ──────────────────────────────────────────────────────────────
function periodStats(txns) {
  const total_spend_cents = txns.reduce((s, t) => s + t.amount_cents, 0);
  const transaction_count = txns.length;
  const outlier_count = txns.filter(t => (outlierMap[t.id] || []).length > 0).length;
  const avg_transaction_cents = transaction_count > 0 ? Math.round(total_spend_cents / transaction_count) : 0;
  return { total_spend_cents, transaction_count, outlier_count, avg_transaction_cents };
}

// ─── Data loader ───────────────────────────────────────────────────────────────
function loadData() {
  if (!fs.existsSync(TRANSACTIONS_FILE)) {
    console.warn('WARNING: data/transactions.json not found. Run fetch-data.py first.');
    transactions = [];
    outlierMap = {};
    cardholderStats = {};
    categoryTotals = {};
    firstMerchantTxns = new Set();
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf8'));
    transactions = raw.map(normalize);
    computeBaselines(transactions);
    detectOutliers(transactions);
    console.log(`Loaded ${transactions.length} transactions, detected ${Object.keys(outlierMap).length} with outliers`);
  } catch (e) {
    console.error('Error loading transactions:', e.message);
    transactions = [];
  }
}

// ─── Startup ───────────────────────────────────────────────────────────────────
loadData();
loadTriage();

// ─── READ endpoints ────────────────────────────────────────────────────────────

// GET /api/summary
app.get('/api/summary', (req, res) => {
  const { from, to } = req.query;
  const txns = from || to ? filterByDate(transactions, from, to) : transactions;
  const activeTxns = txns.filter(t => t.status === 'CLEARED' || t.status === 'PENDING');

  const total_spend_cents = activeTxns.reduce((s, t) => s + t.amount_cents, 0);
  const transaction_count = txns.length;
  const outlier_count = txns.filter(t => (outlierMap[t.id] || []).length > 0).length;
  const avg_transaction_cents = activeTxns.length > 0 ? Math.round(total_spend_cents / activeTxns.length) : 0;

  const by_severity = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const by_triage_status = { flagged: 0, acknowledged: 0, investigating: 0 };
  for (const t of txns) {
    const outs = outlierMap[t.id] || [];
    for (const o of outs) {
      by_severity[o.severity] = (by_severity[o.severity] || 0) + 1;
    }
    const ts = getTriageStatus(t.id);
    if (ts) by_triage_status[ts] = (by_triage_status[ts] || 0) + 1;
  }

  const sparklines = computeSparklines(activeTxns, to);

  res.json({ total_spend_cents, transaction_count, outlier_count, avg_transaction_cents, by_severity, by_triage_status, sparklines });
});

// GET /api/comparison
app.get('/api/comparison', (req, res) => {
  const { from, to } = req.query;
  let currentTxns, previousTxns;

  if (from && to) {
    currentTxns = filterByDate(transactions, from, to);
    const fromD = new Date(from + 'T00:00:00Z');
    const toD = new Date(to + 'T00:00:00Z');
    const lengthMs = toD - fromD + 86400000;
    const prevTo = new Date(fromD - 86400000);
    const prevFrom = new Date(prevTo - lengthMs + 86400000);
    previousTxns = filterByDate(transactions,
      prevFrom.toISOString().substring(0, 10),
      prevTo.toISOString().substring(0, 10));
  } else {
    // No range: compare first half vs second half by date
    const sorted = transactions.filter(t => t.date).sort((a, b) => a.date < b.date ? -1 : 1);
    const mid = Math.floor(sorted.length / 2);
    previousTxns = sorted.slice(0, mid);
    currentTxns = sorted.slice(mid);
  }

  const current = periodStats(currentTxns);
  const previous = periodStats(previousTxns);

  function pctChange(curr, prev) {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return parseFloat(((curr - prev) / prev * 100).toFixed(2));
  }

  const deltas = {
    total_spend_pct: pctChange(current.total_spend_cents, previous.total_spend_cents),
    transaction_count_pct: pctChange(current.transaction_count, previous.transaction_count),
    outlier_count_pct: pctChange(current.outlier_count, previous.outlier_count),
    avg_transaction_pct: pctChange(current.avg_transaction_cents, previous.avg_transaction_cents),
  };

  res.json({ current, previous, deltas });
});

// GET /api/transactions
app.get('/api/transactions', (req, res) => {
  const { status = 'flagged', rule, severity, search, page = '1', limit = '25', sort = 'date', order = 'desc', from, to, category } = req.query;

  let txns = from || to ? filterByDate(transactions, from, to) : [...transactions];

  // Status filter (triage status)
  if (status === 'flagged') {
    txns = txns.filter(t => getTriageStatus(t.id) === 'flagged');
  } else if (status === 'acknowledged') {
    txns = txns.filter(t => getTriageStatus(t.id) === 'acknowledged');
  } else if (status === 'investigating') {
    txns = txns.filter(t => getTriageStatus(t.id) === 'investigating');
  }
  // 'all' = no filter

  // Category filter
  if (category) {
    txns = txns.filter(t => t.mcc_group === category);
  }

  // Rule filter
  if (rule) {
    txns = txns.filter(t => (outlierMap[t.id] || []).some(o => o.rule_id === rule));
  }

  // Severity filter
  if (severity) {
    txns = txns.filter(t => (outlierMap[t.id] || []).some(o => o.severity === severity));
  }

  // Search filter
  if (search) {
    const q = search.toLowerCase();
    txns = txns.filter(t =>
      t.merchant.toLowerCase().includes(q) ||
      t.cardholder.toLowerCase().includes(q) ||
      t.vcn_display_name.toLowerCase().includes(q) ||
      (t.amount_cents / 100).toFixed(2).includes(q)
    );
  }

  // Counts from full date-filtered set (before status filter)
  const allDateFiltered = from || to ? filterByDate(transactions, from, to) : transactions;
  const counts = getCounts(allDateFiltered);

  // Sort
  const validSorts = ['date', 'amount_cents', 'merchant', 'cardholder', 'mcc_group'];
  const sortField = validSorts.includes(sort) ? sort : 'date';
  txns.sort((a, b) => {
    let av = a[sortField] ?? '';
    let bv = b[sortField] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return order === 'asc' ? -1 : 1;
    if (av > bv) return order === 'asc' ? 1 : -1;
    return 0;
  });

  const total = txns.length;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25));
  const pages = Math.ceil(total / limitNum);
  const slice = txns.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json({ transactions: slice.map(enrichTransaction), total, page: pageNum, pages, counts });
});

// GET /api/trends
app.get('/api/trends', (req, res) => {
  const { from, to } = req.query;
  const txns = from || to ? filterByDate(transactions, from, to) : transactions;
  const activeTxns = txns.filter(t => (t.status === 'CLEARED' || t.status === 'PENDING') && t.date);

  const byDay = {};
  for (const t of activeTxns) {
    const dk = t.date.substring(0, 10);
    if (!byDay[dk]) byDay[dk] = { date: dk, amount_cents: 0, count: 0 };
    byDay[dk].amount_cents += t.amount_cents;
    byDay[dk].count += 1;
  }
  const days = Object.values(byDay).sort((a, b) => a.date < b.date ? -1 : 1);

  let cumulative = 0;
  const result = days.map((day, i) => {
    const window = days.slice(Math.max(0, i - 6), i + 1);
    const moving_avg_cents = Math.round(window.reduce((s, d) => s + d.amount_cents, 0) / window.length);
    cumulative += day.amount_cents;
    return { ...day, moving_avg_cents, cumulative_cents: cumulative };
  });

  res.json(result);
});

// GET /api/categories
app.get('/api/categories', (req, res) => {
  const { from, to, all: allParam } = req.query;
  const txns = from || to ? filterByDate(transactions, from, to) : transactions;
  const activeTxns = txns.filter(t => t.status === 'CLEARED' || t.status === 'PENDING');

  const byGroup = {};
  for (const t of activeTxns) {
    if (!byGroup[t.mcc_group]) byGroup[t.mcc_group] = { mcc_group: t.mcc_group, amount_cents: 0, count: 0, outlier_count: 0 };
    byGroup[t.mcc_group].amount_cents += t.amount_cents;
    byGroup[t.mcc_group].count += 1;
    if ((outlierMap[t.id] || []).length > 0) byGroup[t.mcc_group].outlier_count += 1;
  }

  const totalSpend = Object.values(byGroup).reduce((s, c) => s + c.amount_cents, 0);
  let cats = Object.values(byGroup).map(c => ({
    ...c,
    pct_of_total: totalSpend > 0 ? parseFloat(((c.amount_cents / totalSpend) * 100).toFixed(1)) : 0,
    avg_cents: c.count > 0 ? Math.round(c.amount_cents / c.count) : 0,
    sparkline: computeCategorySparkline(c.mcc_group, activeTxns, to),
  })).sort((a, b) => b.amount_cents - a.amount_cents);

  if (allParam !== 'true') cats = cats.slice(0, 10);
  res.json(cats);
});

// GET /api/top-spenders
app.get('/api/top-spenders', (req, res) => {
  const { from, to } = req.query;
  const txns = from || to ? filterByDate(transactions, from, to) : transactions;
  const activeTxns = txns.filter(t => t.status === 'CLEARED' || t.status === 'PENDING');

  const byPerson = {};
  for (const t of activeTxns) {
    if (!byPerson[t.cardholder]) byPerson[t.cardholder] = { cardholder: t.cardholder, total_spend_cents: 0, transaction_count: 0, outlier_count: 0, cat_spend: {} };
    byPerson[t.cardholder].total_spend_cents += t.amount_cents;
    byPerson[t.cardholder].transaction_count += 1;
    if ((outlierMap[t.id] || []).length > 0) byPerson[t.cardholder].outlier_count += 1;
    byPerson[t.cardholder].cat_spend[t.mcc_group] = (byPerson[t.cardholder].cat_spend[t.mcc_group] || 0) + t.amount_cents;
  }

  const spenders = Object.values(byPerson).map(s => {
    const top_category = Object.entries(s.cat_spend).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return { cardholder: s.cardholder, total_spend_cents: s.total_spend_cents, transaction_count: s.transaction_count, outlier_count: s.outlier_count, top_category };
  }).sort((a, b) => b.total_spend_cents - a.total_spend_cents).slice(0, 5);

  res.json(spenders);
});

// GET /api/cardholders — all cardholders with full stats including avg_transaction_cents
app.get('/api/cardholders', (req, res) => {
  const { from, to } = req.query;
  const txns = from || to ? filterByDate(transactions, from, to) : transactions;
  const activeTxns = txns.filter(t => t.status === 'CLEARED' || t.status === 'PENDING');

  const byPerson = {};
  for (const t of activeTxns) {
    if (!byPerson[t.cardholder]) byPerson[t.cardholder] = { cardholder: t.cardholder, total_spend_cents: 0, transaction_count: 0, outlier_count: 0, cat_spend: {} };
    byPerson[t.cardholder].total_spend_cents += t.amount_cents;
    byPerson[t.cardholder].transaction_count += 1;
    if ((outlierMap[t.id] || []).length > 0) byPerson[t.cardholder].outlier_count += 1;
    byPerson[t.cardholder].cat_spend[t.mcc_group] = (byPerson[t.cardholder].cat_spend[t.mcc_group] || 0) + t.amount_cents;
  }

  const cardholders = Object.values(byPerson).map(s => {
    const top_category = Object.entries(s.cat_spend).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const avg_transaction_cents = s.transaction_count > 0 ? Math.round(s.total_spend_cents / s.transaction_count) : 0;
    return { cardholder: s.cardholder, total_spend_cents: s.total_spend_cents, transaction_count: s.transaction_count, outlier_count: s.outlier_count, top_category, avg_transaction_cents };
  }).sort((a, b) => b.total_spend_cents - a.total_spend_cents);

  res.json(cardholders);
});

// GET /api/cardholder/:name
app.get('/api/cardholder/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const { from, to } = req.query;
  const allForPerson = transactions.filter(t => t.cardholder === name);
  const txns = from || to ? filterByDate(allForPerson, from, to) : allForPerson;
  const activeTxns = txns.filter(t => t.status === 'CLEARED' || t.status === 'PENDING');

  if (txns.length === 0) {
    return res.status(404).json({ error: 'Cardholder not found' });
  }

  const total_spend_cents = activeTxns.reduce((s, t) => s + t.amount_cents, 0);
  const transaction_count = txns.length;
  const outlier_count = txns.filter(t => (outlierMap[t.id] || []).length > 0).length;
  const avg_transaction_cents = activeTxns.length > 0 ? Math.round(total_spend_cents / activeTxns.length) : 0;

  // Top categories
  const catSpend = {};
  for (const t of activeTxns) {
    if (!catSpend[t.mcc_group]) catSpend[t.mcc_group] = { mcc_group: t.mcc_group, amount_cents: 0, count: 0 };
    catSpend[t.mcc_group].amount_cents += t.amount_cents;
    catSpend[t.mcc_group].count += 1;
  }
  const top_categories = Object.values(catSpend).sort((a, b) => b.amount_cents - a.amount_cents);

  // Spending timeline
  const spending_timeline = activeTxns
    .filter(t => t.date)
    .sort((a, b) => a.date < b.date ? -1 : 1)
    .map(t => ({ date: t.date.substring(0, 10), amount_cents: t.amount_cents, merchant: t.merchant }));

  // Outlier transactions
  const outlier_transactions = txns
    .filter(t => (outlierMap[t.id] || []).length > 0)
    .map(enrichTransaction);

  // Missing receipt transactions
  const missing_receipt_transactions = txns
    .filter(t => t.receipt_missing && t.amount_cents > 0)
    .map(t => ({ id: t.id, merchant: t.merchant, amount_cents: t.amount_cents, date: t.date }));

  res.json({
    cardholder: name,
    total_spend_cents,
    transaction_count,
    outlier_count,
    avg_transaction_cents,
    top_categories,
    spending_timeline,
    outlier_transactions,
    missing_receipt_transactions,
  });
});

// GET /api/distribution
app.get('/api/distribution', (req, res) => {
  const { from, to } = req.query;
  const txns = from || to ? filterByDate(transactions, from, to) : transactions;
  const activeTxns = txns.filter(t => t.status === 'CLEARED' || t.status === 'PENDING');

  const buckets = [
    { bucket: '$0-25', min_cents: 0, max_cents: 2500 },
    { bucket: '$25-50', min_cents: 2500, max_cents: 5000 },
    { bucket: '$50-100', min_cents: 5000, max_cents: 10000 },
    { bucket: '$100-250', min_cents: 10000, max_cents: 25000 },
    { bucket: '$250-500', min_cents: 25000, max_cents: 50000 },
    { bucket: '$500+', min_cents: 50000, max_cents: null },
  ].map(b => {
    const matching = activeTxns.filter(t =>
      t.amount_cents >= b.min_cents &&
      (b.max_cents === null || t.amount_cents < b.max_cents)
    );
    return { ...b, count: matching.length, total_cents: matching.reduce((s, t) => s + t.amount_cents, 0) };
  });

  res.json(buckets);
});

// GET /api/day-of-week
app.get('/api/day-of-week', (req, res) => {
  const { from, to } = req.query;
  const txns = from || to ? filterByDate(transactions, from, to) : transactions;
  const activeTxns = txns.filter(t => (t.status === 'CLEARED' || t.status === 'PENDING') && t.date);

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const byDow = Array.from({ length: 7 }, (_, i) => ({ day: i, day_name: DAYS[i], total_cents: 0, transaction_count: 0 }));

  for (const t of activeTxns) {
    const dow = new Date(t.date).getDay();
    byDow[dow].total_cents += t.amount_cents;
    byDow[dow].transaction_count += 1;
  }

  const result = byDow.map(d => ({
    ...d,
    avg_spend_cents: d.transaction_count > 0 ? Math.round(d.total_cents / d.transaction_count) : 0,
  }));

  res.json(result);
});

// ─── WRITE endpoints ───────────────────────────────────────────────────────────

// POST /api/actions/triage
app.post('/api/actions/triage', (req, res) => {
  const { transaction_id, triage_status } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id required' });

  const txn = transactions.find(t => t.id === transaction_id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });

  const validStatuses = ['flagged', 'acknowledged', 'investigating'];
  if (!validStatuses.includes(triage_status)) {
    return res.status(400).json({ error: `triage_status must be one of: ${validStatuses.join(', ')}` });
  }

  if (triage_status === 'flagged') {
    delete triageState[transaction_id];
  } else {
    triageState[transaction_id] = { status: triage_status, updated_at: new Date().toISOString() };
  }
  saveTriage();
  res.json({ status: 'ok', transaction_id, triage_status });
});

// POST /api/actions/remind
app.post('/api/actions/remind', async (req, res) => {
  const { transaction_id } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id required' });

  const txn = transactions.find(t => t.id === transaction_id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  if (!txn.receipt_missing) return res.status(400).json({ error: 'Transaction does not require a receipt' });

  const apiKey = process.env.EXTEND_API_KEY;
  const apiSecret = process.env.EXTEND_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'API credentials not configured' });
  }

  try {
    const token = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const response = await fetch(`https://apiv2.paywithextend.com/transactions/${transaction_id}/reminders`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: `Extend API error: ${body}` });
    }
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/actions/bulk
app.post('/api/actions/bulk', async (req, res) => {
  const { action, transaction_ids, triage_status } = req.body;
  if (!action || !Array.isArray(transaction_ids) || transaction_ids.length === 0) {
    return res.status(400).json({ error: 'action and transaction_ids[] required' });
  }

  const results = [];
  const failed = [];

  for (const txn_id of transaction_ids) {
    try {
      const txn = transactions.find(t => t.id === txn_id);
      if (!txn) { failed.push({ id: txn_id, error: 'Not found' }); continue; }

      if (action === 'triage') {
        const validStatuses = ['flagged', 'acknowledged', 'investigating'];
        if (!validStatuses.includes(triage_status)) { failed.push({ id: txn_id, error: 'Invalid triage_status' }); continue; }
        if (triage_status === 'flagged') {
          delete triageState[txn_id];
        } else {
          triageState[txn_id] = { status: triage_status, updated_at: new Date().toISOString() };
        }
        results.push({ id: txn_id, status: 'ok' });
      } else if (action === 'remind') {
        const apiKey = process.env.EXTEND_API_KEY;
        const apiSecret = process.env.EXTEND_API_SECRET;
        if (!apiKey || !apiSecret) { failed.push({ id: txn_id, error: 'API credentials not configured' }); continue; }
        if (!txn.receipt_missing) { failed.push({ id: txn_id, error: 'No receipt required' }); continue; }
        const token = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
        const response = await fetch(`https://apiv2.paywithextend.com/transactions/${txn_id}/reminders`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        });
        if (!response.ok) {
          failed.push({ id: txn_id, error: `API ${response.status}` });
        } else {
          results.push({ id: txn_id, status: 'ok' });
        }
      } else {
        failed.push({ id: txn_id, error: 'Unknown action' });
      }
    } catch (e) {
      failed.push({ id: txn_id, error: e.message });
    }
  }

  if (action === 'triage') saveTriage();
  const overallStatus = failed.length === 0 ? 'ok' : results.length === 0 ? 'failed' : 'partial';
  res.json({ status: overallStatus, results, failed });
});

// POST /api/refresh
app.post('/api/refresh', (req, res) => {
  const pythonBin = path.join(__dirname, '.venv', 'bin', 'python3');
  const script = path.join(__dirname, 'fetch-data.py');

  execFile(pythonBin, [script], { env: process.env, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('fetch-data.py error:', stderr);
      return res.status(500).json({ error: 'Data refresh failed', details: stderr });
    }
    loadData();
    res.json({ status: 'ok', transaction_count: transactions.length });
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
