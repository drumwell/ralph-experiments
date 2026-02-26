# Ralph Wiggum × Extend — Spend Trends Dashboard

A learning exercise for the "Ralph Wiggum" approach to AI-driven software
development. Ralph builds a spend trends and outlier detection dashboard using
real Extend transaction data while you watch (or go get coffee).

## What is Ralph?

Ralph is a bash loop:

```bash
while :; do cat PROMPT.md | claude --dangerously-skip-permissions; done
```

Each iteration, Claude Code reads PROMPT.md, reads files on disk from previous
iterations, writes/edits code, **runs it**, checks if it works, fixes what's
broken, and exits. The loop restarts, and Ralph picks up where it left off.

Files on disk are the memory. Running the code is the feedback. The loop is
the retry.

## Prerequisites

| Requirement | Check | Install |
|-------------|-------|---------|
| Claude Code CLI | `claude --version` | `npm install -g @anthropic-ai/claude-code` |
| Node.js 18+ | `node --version` | https://nodejs.org |
| Python 3 | `python3 --version` | Comes with macOS / `brew install python3` |
| Anthropic auth | `claude auth status` | `claude auth login` or set `ANTHROPIC_API_KEY` |
| **Extend API key** | `echo $EXTEND_API_KEY` | Get from Extend dashboard or your team |

### Extend API Credentials

You need your Extend API credentials exported as environment variables.
Ralph's first move is to fetch your real transaction data.

```bash
export EXTEND_API_KEY=your_api_key_here
export EXTEND_API_SECRET=your_api_secret_here
```

## Quick Start

```bash
# 1. Set your credentials
export EXTEND_API_KEY=your_key
export EXTEND_API_SECRET=your_secret

# 2. Preflight check
chmod +x preflight.sh run-ralph.sh
./preflight.sh

# 3. Start Ralph
./run-ralph.sh
```

Then open http://localhost:3000 after a few iterations.

## What Gets Built

A spend trends dashboard that:
- Fetches real transactions from the Extend API
- Computes statistical baselines per cardholder and category
- Detects outliers (unusual amounts, velocity spikes, category concentration, new merchants, weekend large transactions, missing receipts)
- Visualizes trends: daily spend with moving average, category breakdown, spend distribution, day-of-week heatmap, top spenders
- Provides a triage workflow: flag → acknowledge → investigate
- Supports bulk actions and receipt reminders via the Extend API

## How to Steer Ralph

Edit `specs/PROMPT.md` — the next loop iteration picks up your changes. Or edit
`specs/SPEC.md` to change what gets built.

## The Backpressure Loop

```
PROMPT.md → Claude reads → Writes code → Runs node/curl → Sees output/errors
     ↑                                                            ↓
     └──── Loop restarts ← Claude exits ← Fixes bugs ← ─────────┘
```

Three things make this work:

1. **`--dangerously-skip-permissions`** — Claude can run `node`, `curl`, `pip`,
   `python3` without blocking on permission prompts.

2. **Verification block in PROMPT.md** — Claude is told to start the server and
   curl all endpoints. Errors become the feedback signal.

3. **The `while` loop** — When Claude exits, the loop restarts against current
   file state. Files on disk = memory.

## Cost

~$2-5 per iteration with Sonnet. 5-8 iterations to polished = $10-40.
Change `MODEL` in `run-ralph.sh` to tune.

## Files

```
specs/               ← The brain. All spec and planning files.
run-ralph.sh         ← The loop. Start here.
preflight.sh         ← Environment checker.
tests.sh             ← Growing test suite (Ralph maintains this)
.ralph-iteration     ← Counter (auto-created)
logs/                ← Session logs (auto-created)
fetch-data.py        ← Ralph creates this — fetches from Extend API
data/                ← Transaction JSON + triage state (Ralph creates this)
server.js            ← Express server (Ralph creates this)
public/              ← Dashboard HTML (Ralph creates this)
```
