'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');

// ── Data loading ─────────────────────────────────────────────────────────────

let transactions = [];
let reviews = {};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadTransactions() {
  try {
    if (fs.existsSync(TRANSACTIONS_FILE)) {
      const raw = fs.readFileSync(TRANSACTIONS_FILE, 'utf8');
      transactions = JSON.parse(raw);
      console.log(`Loaded ${transactions.length} transactions`);
    } else {
      console.warn('data/transactions.json not found. Run fetch-data.py first.');
      transactions = [];
    }
  } catch (e) {
    console.error('Error loading transactions:', e.message);
    transactions = [];
  }
}

function loadReviews() {
  ensureDataDir();
  try {
    if (fs.existsSync(REVIEWS_FILE)) {
      const raw = fs.readFileSync(REVIEWS_FILE, 'utf8');
      reviews = JSON.parse(raw);
    } else {
      reviews = {};
      saveReviews();
    }
  } catch (e) {
    console.error('Error loading reviews:', e.message);
    reviews = {};
    saveReviews();
  }
}

function saveReviews() {
  ensureDataDir();
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2), 'utf8');
}

// ── Violation detection ──────────────────────────────────────────────────────

function detectViolations(txns) {
  // Pre-compute lookup structures
  // For DUPLICATE_MERCHANT: group by merchant+cardholder, sorted by date
  const merchantCardholderGroups = {};
  for (const t of txns) {
    const key = `${t.merchant}||${t.cardholder}`;
    if (!merchantCardholderGroups[key]) merchantCardholderGroups[key] = [];
    merchantCardholderGroups[key].push(t);
  }

  // For HIGH_VELOCITY: group by virtual_card_id + calendar day
  const velocityGroups = {};
  for (const t of txns) {
    const day = t.date ? t.date.substring(0, 10) : '';
    const key = `${t.virtual_card_id}||${day}`;
    if (!velocityGroups[key]) velocityGroups[key] = [];
    velocityGroups[key].push(t.id);
  }

  // Build a set of transaction IDs that trigger HIGH_VELOCITY
  const highVelocityIds = new Set();
  for (const ids of Object.values(velocityGroups)) {
    if (ids.length > 5) {
      for (const id of ids) highVelocityIds.add(id);
    }
  }

  // Build a set of transaction IDs that trigger DUPLICATE_MERCHANT
  const duplicateMerchantIds = new Set();
  for (const group of Object.values(merchantCardholderGroups)) {
    if (group.length < 2) continue;
    // Sort by date ascending
    const sorted = group.slice().sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const d1 = new Date(sorted[i].date);
        const d2 = new Date(sorted[j].date);
        const diffMs = Math.abs(d2 - d1);
        const diffHours = diffMs / (1000 * 60 * 60);
        if (diffHours <= 24) {
          duplicateMerchantIds.add(sorted[i].id);
          duplicateMerchantIds.add(sorted[j].id);
        }
      }
    }
  }

  // Attach violations to each transaction
  return txns.map(t => {
    const violations = [];

    // DUPLICATE_MERCHANT: same merchant + cardholder within 24h
    if (duplicateMerchantIds.has(t.id)) {
      violations.push({
        rule_id: 'DUPLICATE_MERCHANT',
        severity: 'HIGH',
        description: 'Same merchant charged by same cardholder within 24 hours',
      });
    }

    // ROUND_AMOUNT: amount_cents % 100 === 0 AND amount_cents > 10000
    if (t.amount_cents % 100 === 0 && t.amount_cents > 10000) {
      violations.push({
        rule_id: 'ROUND_AMOUNT',
        severity: 'MEDIUM',
        description: 'Transaction amount is a round number over $100',
      });
    }

    // WEEKEND_SPEND: date is Saturday (6) or Sunday (0)
    if (t.date) {
      const dow = new Date(t.date).getUTCDay();
      if (dow === 0 || dow === 6) {
        violations.push({
          rule_id: 'WEEKEND_SPEND',
          severity: 'LOW',
          description: 'Transaction occurred on a weekend',
        });
      }
    }

    // MISSING_RECEIPT: receipt_missing === true AND amount_cents > 2500
    if (t.receipt_missing === true && t.amount_cents > 2500) {
      violations.push({
        rule_id: 'MISSING_RECEIPT',
        severity: 'HIGH',
        description: 'Receipt is missing for a transaction over $25',
      });
    }

    // HIGH_VELOCITY: >5 transactions same card in one calendar day
    if (highVelocityIds.has(t.id)) {
      violations.push({
        rule_id: 'HIGH_VELOCITY',
        severity: 'MEDIUM',
        description: 'More than 5 transactions on this card in a single day',
      });
    }

    return { ...t, violations };
  });
}

// ── Enrichment: merge violations with review state ───────────────────────────

function enrichWithReviewStatus(txns) {
  return txns.map(t => {
    const hasViolations = t.violations && t.violations.length > 0;
    let review_status = null;
    let review_updated_at = null;

    if (hasViolations) {
      const reviewEntry = reviews[t.id];
      if (reviewEntry) {
        review_status = reviewEntry.status;
        review_updated_at = reviewEntry.updated_at;
      } else {
        review_status = 'flagged';
      }
    }

    return { ...t, review_status, review_updated_at };
  });
}

// ── Initialize data ──────────────────────────────────────────────────────────

let enrichedTransactions = [];

function initData() {
  loadTransactions();
  loadReviews();

  const withViolations = detectViolations(transactions);
  enrichedTransactions = enrichWithReviewStatus(withViolations);

  console.log(`Violations detected on ${enrichedTransactions.filter(t => t.violations.length > 0).length} transactions`);
}

initData();

// ── Helper: filter transactions ──────────────────────────────────────────────

function filterTransactions({ status = 'flagged', rule, severity, search, sort = 'date', order = 'desc' }) {
  let result = enrichedTransactions;

  // Status filter
  if (status === 'flagged') {
    result = result.filter(t => t.review_status === 'flagged');
  } else if (status === 'under_review') {
    result = result.filter(t => t.review_status === 'under_review');
  } else if (status === 'approved') {
    result = result.filter(t => t.review_status === 'approved');
  }
  // 'all' = no status filter

  // Rule filter
  if (rule) {
    result = result.filter(t => t.violations.some(v => v.rule_id === rule));
  }

  // Severity filter
  if (severity) {
    result = result.filter(t => t.violations.some(v => v.severity === severity));
  }

  // Search filter (case-insensitive substring on merchant, cardholder, card name, amount)
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(t => {
      const amountStr = (t.amount_cents / 100).toFixed(2);
      return (
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.cardholder || '').toLowerCase().includes(q) ||
        (t.vcn_display_name || '').toLowerCase().includes(q) ||
        amountStr.includes(q)
      );
    });
  }

  // Sort
  result = result.slice().sort((a, b) => {
    let aVal = a[sort];
    let bVal = b[sort];
    if (aVal === undefined) aVal = '';
    if (bVal === undefined) bVal = '';
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return order === 'desc' ? bVal - aVal : aVal - bVal;
    }
    const cmp = String(aVal).localeCompare(String(bVal));
    return order === 'desc' ? -cmp : cmp;
  });

  return result;
}

function computeCounts() {
  const flagged = enrichedTransactions.filter(t => t.review_status === 'flagged').length;
  const under_review = enrichedTransactions.filter(t => t.review_status === 'under_review').length;
  const approved = enrichedTransactions.filter(t => t.review_status === 'approved').length;
  const all = enrichedTransactions.length;
  return { flagged, under_review, approved, all };
}

// ── READ Endpoints ───────────────────────────────────────────────────────────

// GET /api/summary
app.get('/api/summary', (req, res) => {
  const total_spend_cents = enrichedTransactions.reduce((sum, t) => sum + (t.amount_cents || 0), 0);
  const transaction_count = enrichedTransactions.length;
  const violating = enrichedTransactions.filter(t => t.violations.length > 0);
  const violation_count = violating.length;
  const compliance_rate = transaction_count > 0
    ? parseFloat(((transaction_count - violation_count) / transaction_count * 100).toFixed(1))
    : 100;

  const by_severity = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const t of violating) {
    const severities = new Set(t.violations.map(v => v.severity));
    if (severities.has('HIGH')) by_severity.HIGH++;
    else if (severities.has('MEDIUM')) by_severity.MEDIUM++;
    else if (severities.has('LOW')) by_severity.LOW++;
  }

  const by_review_status = computeCounts();
  delete by_review_status.all;

  res.json({
    total_spend_cents,
    transaction_count,
    violation_count,
    compliance_rate,
    by_severity,
    by_review_status,
  });
});

// GET /api/transactions
app.get('/api/transactions', (req, res) => {
  const {
    status = 'flagged',
    rule,
    severity,
    search,
    page = '1',
    limit = '25',
    sort = 'date',
    order = 'desc',
  } = req.query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25));

  const filtered = filterTransactions({ status, rule, severity, search, sort, order });
  const total = filtered.length;
  const pages = Math.ceil(total / limitNum) || 1;
  const offset = (pageNum - 1) * limitNum;
  const sliced = filtered.slice(offset, offset + limitNum);

  const counts = computeCounts();

  res.json({
    transactions: sliced,
    total,
    page: pageNum,
    pages,
    counts,
  });
});

// GET /api/trends
app.get('/api/trends', (req, res) => {
  const byDay = {};
  for (const t of enrichedTransactions) {
    const day = t.date ? t.date.substring(0, 10) : 'unknown';
    if (!byDay[day]) byDay[day] = { date: day, amount_cents: 0, count: 0 };
    byDay[day].amount_cents += t.amount_cents || 0;
    byDay[day].count++;
  }

  const result = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  res.json(result);
});

// GET /api/top-offenders
app.get('/api/top-offenders', (req, res) => {
  const offenderMap = {};

  for (const t of enrichedTransactions) {
    if (!t.violations || t.violations.length === 0) continue;
    const name = t.cardholder || 'Unknown';
    if (!offenderMap[name]) {
      offenderMap[name] = {
        cardholder: name,
        violation_count: 0,
        total_spend_cents: 0,
        rule_counts: {},
      };
    }
    offenderMap[name].violation_count += t.violations.length;
    offenderMap[name].total_spend_cents += t.amount_cents || 0;
    for (const v of t.violations) {
      offenderMap[name].rule_counts[v.rule_id] = (offenderMap[name].rule_counts[v.rule_id] || 0) + 1;
    }
  }

  const offenders = Object.values(offenderMap).map(o => {
    const top_rule = Object.entries(o.rule_counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return {
      cardholder: o.cardholder,
      violation_count: o.violation_count,
      total_spend_cents: o.total_spend_cents,
      top_rule,
    };
  });

  offenders.sort((a, b) => b.violation_count - a.violation_count);

  res.json(offenders.slice(0, 5));
});

// ── WRITE Endpoints ──────────────────────────────────────────────────────────

// POST /api/actions/review
app.post('/api/actions/review', (req, res) => {
  const { transaction_id, review_status } = req.body;

  if (!transaction_id || !review_status) {
    return res.status(400).json({ error: 'transaction_id and review_status are required' });
  }

  const validStatuses = ['flagged', 'under_review', 'approved'];
  if (!validStatuses.includes(review_status)) {
    return res.status(400).json({ error: `Invalid review_status: ${review_status}` });
  }

  const txn = enrichedTransactions.find(t => t.id === transaction_id);
  if (!txn) {
    return res.status(404).json({ error: `Transaction not found: ${transaction_id}` });
  }

  if (!txn.violations || txn.violations.length === 0) {
    return res.status(400).json({ error: 'Only transactions with violations can have a review status' });
  }

  const updated_at = new Date().toISOString();
  if (review_status === 'flagged') {
    // Remove from reviews (absence = flagged)
    delete reviews[transaction_id];
  } else {
    reviews[transaction_id] = { status: review_status, updated_at };
  }
  saveReviews();

  // Update in-memory enriched transactions
  const idx = enrichedTransactions.findIndex(t => t.id === transaction_id);
  if (idx !== -1) {
    enrichedTransactions[idx] = {
      ...enrichedTransactions[idx],
      review_status,
      review_updated_at: review_status === 'flagged' ? null : updated_at,
    };
  }

  res.json({ status: 'ok', transaction_id, review_status });
});

// POST /api/actions/remind
app.post('/api/actions/remind', async (req, res) => {
  const { transaction_id } = req.body;

  if (!transaction_id) {
    return res.status(400).json({ error: 'transaction_id is required' });
  }

  const txn = enrichedTransactions.find(t => t.id === transaction_id);
  if (!txn) {
    return res.status(404).json({ error: `Transaction not found: ${transaction_id}` });
  }

  if (!txn.receipt_missing) {
    return res.status(400).json({ error: 'Transaction does not have a missing receipt' });
  }

  const apiKey = process.env.EXTEND_API_KEY;
  const apiSecret = process.env.EXTEND_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'EXTEND_API_KEY and EXTEND_API_SECRET not set' });
  }

  try {
    const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const response = await fetch(
      `https://apiv2.paywithextend.com/transactions/${transaction_id}/reminders`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Extend API reminder error: ${response.status} ${errorText}`);
      return res.status(502).json({ error: `Extend API returned ${response.status}` });
    }

    res.json({ status: 'ok', transaction_id });
  } catch (e) {
    console.error('Error calling Extend API for reminder:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/actions/bulk
app.post('/api/actions/bulk', async (req, res) => {
  const { action, transaction_ids, review_status } = req.body;

  if (!action || !transaction_ids || !Array.isArray(transaction_ids)) {
    return res.status(400).json({ error: 'action and transaction_ids array are required' });
  }

  const results = [];
  const failed = [];

  for (const txn_id of transaction_ids) {
    const txn = enrichedTransactions.find(t => t.id === txn_id);
    if (!txn) {
      failed.push({ transaction_id: txn_id, error: 'Transaction not found' });
      continue;
    }

    if (action === 'review') {
      if (!review_status) {
        failed.push({ transaction_id: txn_id, error: 'review_status required for review action' });
        continue;
      }
      if (!txn.violations || txn.violations.length === 0) {
        failed.push({ transaction_id: txn_id, error: 'No violations — cannot set review status' });
        continue;
      }
      const updated_at = new Date().toISOString();
      if (review_status === 'flagged') {
        delete reviews[txn_id];
      } else {
        reviews[txn_id] = { status: review_status, updated_at };
      }
      const idx = enrichedTransactions.findIndex(t => t.id === txn_id);
      if (idx !== -1) {
        enrichedTransactions[idx] = {
          ...enrichedTransactions[idx],
          review_status,
          review_updated_at: review_status === 'flagged' ? null : updated_at,
        };
      }
      results.push({ transaction_id: txn_id, status: 'ok' });

    } else if (action === 'remind') {
      if (!txn.receipt_missing) {
        failed.push({ transaction_id: txn_id, error: 'No missing receipt' });
        continue;
      }
      const apiKey = process.env.EXTEND_API_KEY;
      const apiSecret = process.env.EXTEND_API_SECRET;
      try {
        const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
        const response = await fetch(
          `https://apiv2.paywithextend.com/transactions/${txn_id}/reminders`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({}),
          }
        );
        if (!response.ok) {
          failed.push({ transaction_id: txn_id, error: `Extend API returned ${response.status}` });
        } else {
          results.push({ transaction_id: txn_id, status: 'ok' });
        }
      } catch (e) {
        failed.push({ transaction_id: txn_id, error: e.message });
      }
    } else {
      failed.push({ transaction_id: txn_id, error: `Unknown action: ${action}` });
    }
  }

  // Save reviews if any review actions succeeded
  if (action === 'review' && results.length > 0) {
    saveReviews();
  }

  const overallStatus = failed.length === 0 ? 'ok' : (results.length > 0 ? 'partial' : 'error');
  res.json({ status: overallStatus, results, failed });
});

// POST /api/refresh
app.post('/api/refresh', (req, res) => {
  const pythonBin = path.join(__dirname, '.venv', 'bin', 'python3');
  const scriptPath = path.join(__dirname, 'fetch-data.py');

  execFile(pythonBin, [scriptPath], { env: process.env, cwd: __dirname }, (error, stdout, stderr) => {
    if (error) {
      console.error('fetch-data.py failed:', stderr);
      return res.status(500).json({ error: `fetch-data.py failed: ${stderr}` });
    }

    console.log('fetch-data.py output:', stdout);

    // Reload data
    initData();

    res.json({ status: 'ok', transaction_count: enrichedTransactions.length });
  });
});

// ── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
