#!/bin/bash
# =============================================================================
# run-ralph.sh — The Ralph Wiggum Loop (v2: Memory Stack Edition)
#
# Designed for 24-hour autonomous runs with drift detection.
#
# Each iteration:
#   1. Increments the iteration counter
#   2. Snapshots specs/STATUS.md (drift detection)
#   3. Pipes specs/PROMPT.md into Claude Code
#   4. Logs the session with timestamps
#   5. Checks for completion signal
#   6. Checks for stuck loops (no specs/STATUS.md change in 5 iterations)
#   7. Repeats
#
# Press Ctrl+C to stop.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Configuration ────────────────────────────────────────────────────────────
MODEL="sonnet"                     # "opus" for quality, "sonnet" for speed/cost
MAX_TURNS=20                       # Tool calls per iteration
LOG_DIR="logs"
RUN_NAME="002-memory-stack"        # For archival
MAX_STUCK=5                        # Alert after N iterations with no specs/STATUS.md change
PAUSE_SECONDS=3                    # Pause between iterations

# ── Setup ────────────────────────────────────────────────────────────────────
mkdir -p data public "$LOG_DIR"

# Create Python venv if needed
if [[ ! -d .venv ]]; then
    echo "  Creating Python venv..."
    python3 -m venv .venv
    echo "  ✓ .venv created"
fi

# ── Cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
    ITER=$(cat .ralph-iteration 2>/dev/null || echo 0)
    ELAPSED=""
    if [[ -n "$START_TIME" ]]; then
        END_TIME=$(date +%s)
        DURATION=$(( END_TIME - START_TIME ))
        HOURS=$(( DURATION / 3600 ))
        MINS=$(( (DURATION % 3600) / 60 ))
        ELAPSED=" (${HOURS}h ${MINS}m)"
    fi
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Ralph stopped after ${ITER} iterations${ELAPSED}"
    echo "  Run: ${RUN_NAME}"
    echo "  Logs: ${LOG_DIR}/"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    pkill -f "node server.js" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Initialize ───────────────────────────────────────────────────────────────
if [[ ! -f .ralph-iteration ]]; then
    echo "0" > .ralph-iteration
fi

START_TIME=$(date +%s)
STUCK_COUNT=0
LAST_STATUS_HASH=""

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧠 Ralph Wiggum v2 — Memory Stack Edition"
echo "  Run: ${RUN_NAME}"
echo "  Model: ${MODEL}"
echo "  Max turns per iteration: ${MAX_TURNS}"
echo "  Stuck detection: alert after ${MAX_STUCK} unchanged iterations"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Press Ctrl+C to stop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── The Loop ─────────────────────────────────────────────────────────────────
while true; do
    # Increment iteration
    ITER=$(( $(cat .ralph-iteration) + 1 ))
    echo "$ITER" > .ralph-iteration

    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    LOG_FILE="${LOG_DIR}/ralph_iter${ITER}_${TIMESTAMP}.log"

    # Calculate elapsed time
    NOW=$(date +%s)
    ELAPSED=$(( NOW - START_TIME ))
    HOURS=$(( ELAPSED / 3600 ))
    MINS=$(( (ELAPSED % 3600) / 60 ))

    echo ""
    echo "┌───────────────────────────────────────────────────┐"
    echo "│  Iteration ${ITER} — $(date '+%H:%M:%S') — elapsed ${HOURS}h ${MINS}m"
    echo "└───────────────────────────────────────────────────┘"

    # ── Drift detection: check if specs/STATUS.md changed ────────────────
    if [[ -f specs/STATUS.md ]]; then
        CURRENT_HASH=$(md5sum specs/STATUS.md 2>/dev/null | cut -d' ' -f1 || echo "none")
        if [[ "$CURRENT_HASH" == "$LAST_STATUS_HASH" ]]; then
            STUCK_COUNT=$(( STUCK_COUNT + 1 ))
            if [[ $STUCK_COUNT -ge $MAX_STUCK ]]; then
                echo "  ⚠️  WARNING: specs/STATUS.md unchanged for ${STUCK_COUNT} iterations (possible stuck loop)"
                echo "  ⚠️  Consider checking logs or editing specs/PROMPT.md to unstick"
            fi
        else
            STUCK_COUNT=0
        fi
        LAST_STATUS_HASH="$CURRENT_HASH"
    fi

    # ── Log current milestone for observability ──────────────────────────
    if [[ -f specs/STATUS.md ]]; then
        CURRENT_MILESTONE=$(grep "Current milestone:" specs/STATUS.md 2>/dev/null | head -1 || echo "unknown")
        echo "  📍 ${CURRENT_MILESTONE}"
    fi

    # Kill any leftover server from previous iteration
    pkill -f "node server.js" 2>/dev/null || true

    # ── Run Claude ───────────────────────────────────────────────────────
    PROMPT=$(cat specs/PROMPT.md)
    claude \
        --permission-mode bypassPermissions \
        --max-turns "$MAX_TURNS" \
        --model "$MODEL" \
        "$PROMPT" \
        2>&1 | tee "$LOG_FILE"

    EXIT_CODE=$?

    # ── Post-iteration summary ───────────────────────────────────────────
    LOG_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
    echo ""
    echo "  ↳ Iteration ${ITER} exited (code ${EXIT_CODE}, log ${LOG_SIZE} bytes)"

    # Warn on empty logs (iteration did nothing)
    if [[ $LOG_SIZE -lt 100 ]]; then
        echo "  ⚠️  Very small log — iteration may have done nothing"
    fi

    # ── Check for completion ─────────────────────────────────────────────
    if grep -q "<promise>COMPLETE</promise>" "$LOG_FILE" 2>/dev/null; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  ✅ Ralph completed all milestones!"
        echo "  Total iterations: ${ITER}"
        echo "  Elapsed: ${HOURS}h ${MINS}m"
        echo "  Run: ${RUN_NAME}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        # Archive the run
        echo "  📦 Archiving to runs/${RUN_NAME}/..."
        mkdir -p "runs/${RUN_NAME}/output"
        cp -f fetch-data.py server.js public/index.html package.json "runs/${RUN_NAME}/output/" 2>/dev/null || true
        cp -rf specs "runs/${RUN_NAME}/" 2>/dev/null || true
        cp -rf logs "runs/${RUN_NAME}/" 2>/dev/null || true
        cp -rf screenshots "runs/${RUN_NAME}/" 2>/dev/null || true
        echo "  ✓ Archived"
        break
    fi

    # Brief pause
    sleep $PAUSE_SECONDS
done
