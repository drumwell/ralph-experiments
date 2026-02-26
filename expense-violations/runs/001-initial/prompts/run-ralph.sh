#!/bin/bash
# =============================================================================
# run-ralph.sh — The Ralph Wiggum Loop (v1 — Original)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p data public logs

if [[ ! -d .venv ]]; then
    echo "  Creating Python venv..."
    python3 -m venv .venv
    echo "  ✓ .venv created"
fi

MODEL="sonnet"
MAX_TURNS=20
LOG_DIR="logs"

cleanup() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Ralph stopped after $(cat .ralph-iteration 2>/dev/null || echo 0) iterations"
    echo "  Logs: ${LOG_DIR}/"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    pkill -f "node server.js" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

if [[ ! -f .ralph-iteration ]]; then
    echo "0" > .ralph-iteration
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧠 Ralph Wiggum — Expense Dashboard Builder"
echo "  Model: ${MODEL}"
echo "  Max turns per iteration: ${MAX_TURNS}"
echo "  Press Ctrl+C to stop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

while true; do
    ITER=$(( $(cat .ralph-iteration) + 1 ))
    echo "$ITER" > .ralph-iteration

    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    LOG_FILE="${LOG_DIR}/ralph_iter${ITER}_${TIMESTAMP}.log"

    echo ""
    echo "┌─────────────────────────────────────────┐"
    echo "│  Iteration ${ITER} — $(date '+%H:%M:%S')                    │"
    echo "└─────────────────────────────────────────┘"
    echo ""

    pkill -f "node server.js" 2>/dev/null || true

    PROMPT=$(cat PROMPT.md)
    claude \
        --permission-mode bypassPermissions \
        --max-turns "$MAX_TURNS" \
        --model "$MODEL" \
        "$PROMPT" \
        2>&1 | tee "$LOG_FILE"

    EXIT_CODE=$?

    echo ""
    echo "  ↳ Iteration ${ITER} exited with code ${EXIT_CODE}"
    echo "  ↳ Log: ${LOG_FILE}"

    if grep -q "<promise>COMPLETE</promise>" "$LOG_FILE" 2>/dev/null; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  ✅ Ralph completed all tasks!"
        echo "  Total iterations: ${ITER}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        break
    fi

    sleep 3
done
