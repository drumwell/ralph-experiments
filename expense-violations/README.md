# Ralph Wiggum × Extend — Expense Compliance Dashboard

A learning exercise for the "Ralph Wiggum" approach to AI-driven software
development. Ralph builds an expense policy violation dashboard using real
Extend transaction data while you watch (or go get coffee).

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
export EXTEND_API_SECRET=your_api_secret_here  # if your auth flow uses this
```

If you don't have these handy, Ralph falls back to mock data — you'll still
learn the pattern, just with fake transactions.

**No venv needed.** Claude will `pip install extend-ai` on the first iteration.
No MCP server config needed for Claude Code — the Python client handles API
access directly.

## Quick Start

```bash
# 1. Unpack
tar xzf ralph-expense-demo.tar.gz
cd ralph-expense-demo

# 2. Set your credentials
export EXTEND_API_KEY=your_key
export EXTEND_API_SECRET=your_secret

# 3. Preflight check
chmod +x preflight.sh run-ralph.sh
./preflight.sh

# 4. Start Ralph
./run-ralph.sh
```

Then open http://localhost:3000 after a few iterations.

## What Happens

**Iteration 1 (3-5 min):** Ralph installs `extend-ai`, writes `fetch-data.py`,
fetches your real transactions, scaffolds `server.js` and `public/index.html`.
Probably hits an error (wrong field name, missing dep). That's the point.

**Iteration 2 (3-5 min):** Ralph reads the files, sees what broke, fixes it.
Server starts, `curl` returns data. Dashboard exists but might be ugly.

**Iteration 3+ (refinement):** Charts render with your real data, violation
detection improves, styling gets polished. Each iteration compounds.

**~30 min in:** Working dashboard showing your actual Extend transactions with
policy violation analysis.

## How to Steer Ralph

Edit `PROMPT.md` — the next loop iteration picks up your changes. Examples:

```markdown
# When Ralph gets the Extend API schema wrong:
NOTE: The Extend API returns `authorizationAmount` not `amountCents`.
Check the /api/raw endpoint output and use those exact field names.

# When the UI needs work:
The violations table must show alternating row colors for readability.
Add a search/filter box above the table.

# When you want a new feature:
Add a "Top Spenders" card showing the top 5 cardholders by total amount.
```

## The Backpressure Loop

```
PROMPT.md → Claude reads → Writes code → Runs node/curl → Sees output/errors
     ↑                                                            ↓
     └──── Loop restarts ← Claude exits ← Fixes bugs ← ─────────┘
```

Three things make this work:

1. **`--dangerously-skip-permissions`** — Claude can run `node`, `curl`, `pip`,
   `python3` without blocking on permission prompts. This closes the feedback loop.

2. **Verification block in PROMPT.md** — Claude is told to start the server and
   curl all endpoints. Errors become the feedback signal for the next fix.

3. **The `while` loop** — When Claude exits (tool limit, thinks it's done, errors),
   the loop restarts against current file state. Files on disk = memory.

## Cost

~$2-5 per iteration with Opus 4.5. 5-8 iterations to polished = $10-40.
Change `MODEL` in `run-ralph.sh` to Sonnet for cheaper runs.

## Files

```
PROMPT.md           ← The brain. Edit to steer Ralph.
run-ralph.sh        ← The loop. Start here.
preflight.sh        ← Environment checker.
.ralph-iteration    ← Counter (auto-created)
logs/               ← Session logs (auto-created)
fetch-data.py       ← Ralph creates this — fetches from Extend API
data/               ← Transaction JSON (Ralph creates this)
server.js           ← Express server (Ralph creates this)
public/             ← Dashboard HTML (Ralph creates this)
```
