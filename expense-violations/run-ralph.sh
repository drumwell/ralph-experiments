#!/bin/bash
# =============================================================================
# run-ralph.sh — The Ralph Wiggum Loop (v4: Plan → Build → Test → Review → Commit)
#
# Each iteration:
#   1. Increments the iteration counter
#   2. Snapshots specs/STATUS.md (drift detection)
#   3. If iteration 1 (or no fix_plan.md): runs PLANNING phase (generates fix_plan.md)
#   4. Otherwise: runs BUILDER phase (picks top task from fix_plan.md)
#   5. Runs tests.sh and writes results to specs/TEST_RESULTS.md
#   6. Optionally runs REVIEWER phase (adversarial code review)
#   7. Auto-commits via git
#   8. Checks for completion signal
#   9. Checks for stuck loops (no specs/STATUS.md change in 5 iterations)
#   10. Repeats
#
# Press Ctrl+C to stop.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Configuration ────────────────────────────────────────────────────────────
MODEL="sonnet"                     # "opus" for quality, "sonnet" for speed/cost
PLANNER_MODEL="sonnet"             # Planner can use a stronger model if desired
REVIEWER_MODEL="sonnet"            # Reviewer runs on sonnet (cheaper, analysis-only)
MAX_TURNS=50                       # Tool calls per builder iteration (needs ~10 for file reads before work)
PLANNER_MAX_TURNS=40               # Planner gets more turns (subagent research)
REVIEWER_MAX_TURNS=25              # Reviewer needs fewer turns (read + curl + write)
LOG_DIR="logs"
RUN_NAME="007-faithful-ralph"      # For archival
MAX_STUCK=5                        # Alert after N iterations with no specs/STATUS.md change
PAUSE_SECONDS=10                   # Pause between iterations (memory cooldown)
REVIEW_EVERY_N=3                   # Run reviewer every N iterations
export TEST_TIMEOUT=60             # Timeout for tests.sh in seconds (exported for perl fallback)
MAX_ITERATIONS=30                  # Safety cap — stop after this many iterations

# ── Setup ────────────────────────────────────────────────────────────────────
mkdir -p data public "$LOG_DIR" screenshots

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

# ── Helper: extract current milestone number from STATUS.md ──────────────────
get_current_milestone() {
    if [[ -f specs/STATUS.md ]]; then
        grep "Current milestone:" specs/STATUS.md 2>/dev/null | head -1 | sed 's/[^0-9]*//g' | head -1 || echo "0"
    else
        echo "0"
    fi
}

# ── Helper: extract first line of Current Task from STATUS.md ────────────────
get_current_task() {
    if [[ -f specs/STATUS.md ]]; then
        sed -n '/^## Current Task/,/^##/{/^## Current Task/d;/^##/d;/^$/d;p;}' specs/STATUS.md 2>/dev/null | head -1 || echo "iteration work"
    else
        echo "iteration work"
    fi
}

# ── Initialize ───────────────────────────────────────────────────────────────
if [[ ! -f .ralph-iteration ]]; then
    echo "0" > .ralph-iteration
fi

START_TIME=$(date +%s)
STUCK_COUNT=0
LAST_STATUS_HASH=""

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧠 Ralph Wiggum v4 — Plan → Build → Test → Review → Commit"
echo "  Run: ${RUN_NAME}"
echo "  Builder model: ${MODEL} (${MAX_TURNS} turns)"
echo "  Planner model: ${PLANNER_MODEL} (${PLANNER_MAX_TURNS} turns)"
echo "  Reviewer model: ${REVIEWER_MODEL} (${REVIEWER_MAX_TURNS} turns)"
echo "  Reviewer: every ${REVIEW_EVERY_N} iterations"
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

    # ── Safety cap ─────────────────────────────────────────────────────
    if [[ $ITER -gt $MAX_ITERATIONS ]]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  ⛔ Hit iteration cap (${MAX_ITERATIONS}). Stopping."
        echo "  Total iterations: $(( ITER - 1 ))"
        echo "  Elapsed: ${HOURS}h ${MINS}m"
        echo "  Run: ${RUN_NAME}"
        echo "  Check specs/STATUS.md and specs/fix_plan.md for current state."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        break
    fi

    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    BUILD_LOG="${LOG_DIR}/ralph_iter${ITER}_${TIMESTAMP}.log"
    REVIEW_LOG="${LOG_DIR}/review_iter${ITER}_${TIMESTAMP}.log"
    PLAN_LOG="${LOG_DIR}/plan_iter${ITER}_${TIMESTAMP}.log"

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

    # ── Log current state for observability ──────────────────────────────
    if [[ -f specs/STATUS.md ]]; then
        CURRENT_MILESTONE_TEXT=$(grep "Current milestone:" specs/STATUS.md 2>/dev/null | head -1 || echo "unknown")
        echo "  📍 ${CURRENT_MILESTONE_TEXT}"
    fi

    # Kill any leftover server from previous iteration
    pkill -f "node server.js" 2>/dev/null || true

    # ── Decide: PLANNING or BUILDING phase ───────────────────────────────
    if [[ ! -f specs/fix_plan.md ]]; then
        # ── PLANNING phase ───────────────────────────────────────────────
        echo "  📋 Planner starting (generating fix_plan.md)..."
        PROMPT=$(cat specs/PLANNING_PROMPT.md)
        claude \
            --permission-mode bypassPermissions \
            --max-turns "$PLANNER_MAX_TURNS" \
            --model "$PLANNER_MODEL" \
            "$PROMPT" \
            2>&1 | tee "$PLAN_LOG"

        PLAN_EXIT=$?
        PLAN_LOG_SIZE=$(wc -c < "$PLAN_LOG" 2>/dev/null || echo 0)
        echo ""
        echo "  ↳ Planner exited (code ${PLAN_EXIT}, log ${PLAN_LOG_SIZE} bytes)"

        if [[ -f specs/fix_plan.md ]]; then
            TASK_COUNT=$(grep -c "^\- \[ \]" specs/fix_plan.md 2>/dev/null || echo 0)
            echo "  📋 fix_plan.md generated with ${TASK_COUNT} unchecked tasks"
        else
            echo "  ⚠️  Planner did not create fix_plan.md — will retry next iteration"
        fi
    else
        # ── BUILDER phase ────────────────────────────────────────────────
        echo "  🔨 Builder starting..."
        PROMPT=$(cat specs/PROMPT.md)
        claude \
            --permission-mode bypassPermissions \
            --max-turns "$MAX_TURNS" \
            --model "$MODEL" \
            "$PROMPT" \
            2>&1 | tee "$BUILD_LOG"

        BUILD_EXIT=$?
        BUILD_LOG_SIZE=$(wc -c < "$BUILD_LOG" 2>/dev/null || echo 0)
        echo ""
        echo "  ↳ Builder exited (code ${BUILD_EXIT}, log ${BUILD_LOG_SIZE} bytes)"

        if [[ $BUILD_LOG_SIZE -lt 100 ]]; then
            echo "  ⚠️  Very small log — builder may have done nothing"
        fi

        # ── Check for completion ─────────────────────────────────────────
        if grep -q "<promise>COMPLETE</promise>" "$BUILD_LOG" 2>/dev/null; then
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  ✅ Ralph completed all milestones!"
            echo "  Total iterations: ${ITER}"
            echo "  Elapsed: ${HOURS}h ${MINS}m"
            echo "  Run: ${RUN_NAME}"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

            # Final commit
            git add -A && git commit -m "ralph: COMPLETE — all milestones verified" 2>/dev/null || true
            git tag "${RUN_NAME}-complete" 2>/dev/null || true

            # Archive the run
            echo "  📦 Archiving to runs/${RUN_NAME}/..."
            mkdir -p "runs/${RUN_NAME}/output/public" "runs/${RUN_NAME}/output/data"
            cp -f fetch-data.py server.js package.json "runs/${RUN_NAME}/output/" 2>/dev/null || true
            cp -f public/index.html "runs/${RUN_NAME}/output/public/" 2>/dev/null || true
            cp -f data/transactions.json data/reviews.json "runs/${RUN_NAME}/output/data/" 2>/dev/null || true
            # Patch port so archived runs don't collide: run NNN → port 3000+NNN
            RUN_NUM=$(echo "$RUN_NAME" | grep -o '^[0-9]*' | sed 's/^0*//')
            if [[ -n "$RUN_NUM" ]] && [[ -f "runs/${RUN_NAME}/output/server.js" ]]; then
                RUN_PORT=$((3000 + RUN_NUM))
                sed -i'' -e "s/const PORT = .*/const PORT = ${RUN_PORT};/" "runs/${RUN_NAME}/output/server.js"
                echo "  ✓ Port patched to ${RUN_PORT}"
            fi
            cp -rf specs "runs/${RUN_NAME}/" 2>/dev/null || true
            cp -rf logs "runs/${RUN_NAME}/" 2>/dev/null || true
            cp -rf screenshots "runs/${RUN_NAME}/" 2>/dev/null || true
            echo "  ✓ Archived"
            break
        fi
    fi

    # ── GIT phase (commit BEFORE tests — creates rollback point) ────────
    pkill -f "node server.js" 2>/dev/null || true

    TASK_DESC=$(get_current_task)
    COMMITTED=false
    if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]] 2>/dev/null; then
        echo "  📝 Git: no changes to commit"
    else
        git add -A 2>/dev/null || true
        COMMIT_MSG="ralph: iteration ${ITER} — ${TASK_DESC}"
        if git commit -m "$COMMIT_MSG" 2>/dev/null; then
            echo "  📝 Git: committed — ${COMMIT_MSG}"
            COMMITTED=true
        else
            echo "  📝 Git: commit failed (may be no changes)"
        fi
    fi

    # ── TEST phase ───────────────────────────────────────────────────────
    # Kill any leftover server before tests (tests.sh starts its own)
    pkill -f "node server.js" 2>/dev/null || true

    if [[ -f tests.sh ]]; then
        echo ""
        echo "  🧪 Running tests.sh..."

        # Run tests with timeout, capture output
        # macOS doesn't have `timeout` — use perl one-liner as fallback
        if command -v timeout &>/dev/null; then
            TEST_OUTPUT=$(timeout "$TEST_TIMEOUT" bash tests.sh 2>&1 || true)
        else
            TEST_OUTPUT=$(perl -e "alarm $ENV{TEST_TIMEOUT}; exec 'bash', 'tests.sh'" 2>&1 || true)
        fi
        TEST_EXIT=${PIPESTATUS[0]:-$?}

        # Show summary
        PASS_COUNT=$(echo "$TEST_OUTPUT" | grep -c "PASS:" || echo 0)
        FAIL_COUNT=$(echo "$TEST_OUTPUT" | grep -c "FAIL:" || echo 0)
        if [[ $TEST_EXIT -eq 0 ]]; then
            echo "  ✅ Tests: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
        else
            echo "  ❌ Tests: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
        fi

        # ── ROLLBACK on test failure ─────────────────────────────────────
        if [[ $TEST_EXIT -ne 0 ]] && [[ "$COMMITTED" == "true" ]]; then
            echo "  ⏪ Tests failed — rolling back code to last green state"

            # Save the spec files that Ralph updated (these are valuable even on failure)
            SAVED_STATUS=$(cat specs/STATUS.md 2>/dev/null || true)
            SAVED_AGENTS=$(cat specs/AGENTS.md 2>/dev/null || true)
            SAVED_PLAN=$(cat specs/fix_plan.md 2>/dev/null || true)

            # Revert the commit (undo Ralph's code changes)
            git reset --hard HEAD~1 2>/dev/null || true

            # Restore the spec files (Ralph's memory survives the rollback)
            [[ -n "$SAVED_STATUS" ]] && echo "$SAVED_STATUS" > specs/STATUS.md
            [[ -n "$SAVED_AGENTS" ]] && echo "$SAVED_AGENTS" > specs/AGENTS.md
            [[ -n "$SAVED_PLAN" ]] && echo "$SAVED_PLAN" > specs/fix_plan.md

            echo "  ⏪ Code reverted. Spec files (STATUS.md, AGENTS.md, fix_plan.md) preserved."

            # Commit the preserved spec files so they're not lost
            git add specs/ 2>/dev/null || true
            git diff --cached --quiet 2>/dev/null || {
                git commit -m "ralph: iteration ${ITER} — rolled back (tests failed), specs preserved" 2>/dev/null || true
            }
        fi

        # Write results for next iteration (AFTER rollback so Ralph sees what happened)
        {
            echo "# Test Results"
            echo ""
            echo "Run at: $(date '+%Y-%m-%d %H:%M:%S') (iteration ${ITER})"
            echo "Exit code: ${TEST_EXIT}"
            echo ""
            if [[ $TEST_EXIT -eq 0 ]]; then
                echo "## Status: ALL TESTS PASSED ✅"
            else
                echo "## Status: TESTS FAILED ❌ — CODE WAS ROLLED BACK"
                echo ""
                echo "**Your code changes from iteration ${ITER} broke tests and were reverted.**"
                echo "**The codebase is back to its state before your changes.**"
                echo "**Study the failures below, then try a different approach.**"
            fi
            echo ""
            echo "## Output"
            echo '```'
            echo "$TEST_OUTPUT"
            echo '```'
        } > specs/TEST_RESULTS.md

        # Commit TEST_RESULTS.md so next iteration sees it
        git add specs/TEST_RESULTS.md 2>/dev/null || true
        git diff --cached --quiet 2>/dev/null || {
            git commit -m "ralph: iteration ${ITER} — test results" 2>/dev/null || true
        }
    else
        echo "  ⏭️  tests.sh not found — skipping test phase"
    fi

    # ── REVIEWER phase (conditional) ─────────────────────────────────────
    if [[ -f specs/fix_plan.md ]] && [[ $(( ITER % REVIEW_EVERY_N )) -eq 0 ]]; then
        echo ""
        echo "  🔍 Reviewer starting (iteration ${ITER} is review cycle)..."

        # Kill any leftover server before reviewer starts
        pkill -f "node server.js" 2>/dev/null || true

        REVIEW_PROMPT=$(cat specs/REVIEW_PROMPT.md)
        claude \
            --permission-mode bypassPermissions \
            --max-turns "$REVIEWER_MAX_TURNS" \
            --model "$REVIEWER_MODEL" \
            "$REVIEW_PROMPT" \
            2>&1 | tee "$REVIEW_LOG"

        REVIEW_EXIT=$?
        REVIEW_LOG_SIZE=$(wc -c < "$REVIEW_LOG" 2>/dev/null || echo 0)
        echo "  ↳ Reviewer exited (code ${REVIEW_EXIT}, log ${REVIEW_LOG_SIZE} bytes)"

        # Show review summary if REVIEW.md was created/updated
        if [[ -f specs/REVIEW.md ]]; then
            BLOCKER_COUNT=$(grep -c "\[BLOCKER\]" specs/REVIEW.md 2>/dev/null || echo 0)
            WARNING_COUNT=$(grep -c "\[WARNING\]" specs/REVIEW.md 2>/dev/null || echo 0)
            echo "  📋 Review: ${BLOCKER_COUNT} blockers, ${WARNING_COUNT} warnings"
        fi
    else
        if [[ ! -f specs/fix_plan.md ]]; then
            echo "  ⏭️  Reviewer skipped (planning phase — no code to review yet)"
        else
            echo "  ⏭️  Reviewer skipped (not a review cycle — next at iteration $(( (ITER / REVIEW_EVERY_N + 1) * REVIEW_EVERY_N )))"
        fi
    fi

    # Kill any leftover server
    pkill -f "node server.js" 2>/dev/null || true

    # Brief pause
    sleep $PAUSE_SECONDS
done
