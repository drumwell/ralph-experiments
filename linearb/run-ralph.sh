#!/bin/bash
# =============================================================================
# run-ralph.sh — The Ralph Wiggum Loop
#
# Each iteration:
#   1. Increments the iteration counter
#   2. Checks for replan triggers (stuck, reviewer, manual)
#   3. If no PLAN.md: runs PLANNING phase with validation + review gate
#   4. Otherwise: runs BUILDER phase
#   5. Runs tests.sh and writes results to specs/TEST_RESULTS.md
#   6. Optionally runs REVIEWER phase
#   7. Auto-commits via git
#   8. Checks for completion signal
#   9. Repeats
#
# Press Ctrl+C to stop.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Load project config ──────────────────────────────────────────────────────
if [[ ! -f project.conf ]]; then
    echo "ERROR: project.conf not found in $(pwd)"
    echo "Create a project.conf with your project-specific settings."
    exit 1
fi
source project.conf

# ── Configuration ────────────────────────────────────────────────────────────
MODEL="sonnet"
PLANNER_MODEL="opus"
REVIEWER_MODEL="sonnet"
MAX_TURNS=50
PLANNER_MAX_TURNS=60
REVIEWER_MAX_TURNS=25
LOG_DIR="logs"
# Auto-increment run name
LAST_RUN=$(ls -d runs/[0-9]*-* 2>/dev/null | sort -V | tail -1 | grep -o '[0-9]*' | head -1 | sed 's/^0*//')
NEXT_NUM=$(printf "%03d" $(( ${LAST_RUN:-0} + 1 )))
RUN_NAME="${NEXT_NUM}-$(date '+%Y%m%d-%H%M')"
MAX_STUCK=5
PAUSE_SECONDS=10
REVIEW_EVERY_N=3
export TEST_TIMEOUT=60
MAX_ITERATIONS=75

# Planning defaults (overridable in project.conf)
MIN_PLAN_TASKS=${MIN_PLAN_TASKS:-10}
MAX_PLAN_TASKS=${MAX_PLAN_TASKS:-60}
MAX_PLAN_ATTEMPTS=${MAX_PLAN_ATTEMPTS:-3}
PLAN_REVIEW_MODEL=${PLAN_REVIEW_MODEL:-$REVIEWER_MODEL}
PLAN_REVIEW_MAX_TURNS=${PLAN_REVIEW_MAX_TURNS:-30}
REPLAN_ON_STUCK=${REPLAN_ON_STUCK:-true}
REPLAN_ON_REVIEW=${REPLAN_ON_REVIEW:-true}
REPLAN_MANUAL_FILE=${REPLAN_MANUAL_FILE:-.ralph-replan}

# ── Setup ────────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR" runs "${PROJECT_DIRS[@]}"

# Run project-specific setup
if type setup_project &>/dev/null; then
    setup_project
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
    [[ -n "$KILL_PATTERN" ]] && pkill -f "$KILL_PATTERN" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Helpers ──────────────────────────────────────────────────────────────────
get_current_task() {
    if [[ -f specs/PLAN.md ]]; then
        grep -m1 "^\- \[ \]" specs/PLAN.md 2>/dev/null | sed 's/- \[ \] \*\*//' | sed 's/\*\*.*//' | head -c 80 || echo "iteration work"
    else
        echo "planning"
    fi
}

# ── Plan validation ──────────────────────────────────────────────────────────
# Mechanical checks on PLAN.md structure before running the AI reviewer.
# Returns 0 if plan passes basic checks, 1 if it fails.
validate_plan() {
    local plan_file="specs/PLAN.md"

    if [[ ! -f "$plan_file" ]]; then
        echo "    FAIL: PLAN.md does not exist"
        return 1
    fi

    local task_count
    task_count=$(grep -c "^\- \[ \]" "$plan_file" 2>/dev/null || echo 0)

    # Check task count bounds
    if [[ $task_count -lt $MIN_PLAN_TASKS ]]; then
        echo "    FAIL: Only ${task_count} tasks (minimum: ${MIN_PLAN_TASKS}). Plan is too coarse."
        return 1
    fi

    if [[ $task_count -gt $MAX_PLAN_TASKS ]]; then
        echo "    FAIL: ${task_count} tasks (maximum: ${MAX_PLAN_TASKS}). Plan is too granular."
        return 1
    fi

    # Check that the plan has roughly as many Verify sections as tasks
    # (tasks may be multi-line, so we count Verify occurrences globally)
    local verify_count
    verify_count=$(grep -ci "verify:" "$plan_file" 2>/dev/null || echo 0)

    if [[ $verify_count -lt $task_count ]]; then
        local missing=$(( task_count - verify_count ))
        echo "    FAIL: ${verify_count} Verify sections for ${task_count} tasks (${missing} missing)"
        return 1
    fi

    # Check for spec coverage map
    if ! grep -qi "spec coverage" "$plan_file" 2>/dev/null; then
        echo "    FAIL: No Spec Coverage Map found in PLAN.md"
        return 1
    fi

    echo "    OK: ${task_count} tasks, all have verify sections, coverage map present"
    return 0
}

# ── Trigger replan ───────────────────────────────────────────────────────────
# Moves current PLAN.md to PLAN.md.prev and removes PLAN.md so the next
# iteration enters planning mode. Preserves completed task state.
trigger_replan() {
    local reason="$1"
    echo "  REPLAN triggered: ${reason}"

    if [[ -f specs/PLAN.md ]]; then
        cp specs/PLAN.md specs/PLAN.md.prev
        rm specs/PLAN.md
        echo "  Moved PLAN.md → PLAN.md.prev"
    fi

    # Clean up stale review files so the new planner starts fresh
    rm -f specs/PLAN_REVIEW.md 2>/dev/null || true

    # Reset stuck counter since we're starting fresh
    STUCK_COUNT=0

    git add specs/ 2>/dev/null || true
    git diff --cached --quiet 2>/dev/null || {
        git commit -m "ralph: iteration ${ITER} — replan (${reason})" 2>/dev/null || true
    }
}

# ── Initialize ───────────────────────────────────────────────────────────────
if [[ ! -f .ralph-iteration ]]; then
    echo "0" > .ralph-iteration
fi

START_TIME=$(date +%s)
STUCK_COUNT=0
LAST_STATUS_HASH=""
PLAN_ATTEMPT=0

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Ralph Wiggum — ${PROJECT_NAME}"
echo "  Run: ${RUN_NAME}"
echo "  Builder: ${MODEL} (${MAX_TURNS} turns)"
echo "  Planner: ${PLANNER_MODEL} (${PLANNER_MAX_TURNS} turns)"
echo "  Plan review: ${PLAN_REVIEW_MODEL} (${PLAN_REVIEW_MAX_TURNS} turns)"
echo "  Plan tasks: ${MIN_PLAN_TASKS}–${MAX_PLAN_TASKS}, max ${MAX_PLAN_ATTEMPTS} attempts"
echo "  Reviewer: ${REVIEWER_MODEL} every ${REVIEW_EVERY_N} iters"
echo "  Max iterations: ${MAX_ITERATIONS}"
echo "  Replan on stuck: ${REPLAN_ON_STUCK} (after ${MAX_STUCK} iters)"
echo "  Replan on review: ${REPLAN_ON_REVIEW}"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Press Ctrl+C to stop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── The Loop ─────────────────────────────────────────────────────────────────
set +e
while true; do
    ITER=$(( $(cat .ralph-iteration) + 1 ))
    echo "$ITER" > .ralph-iteration

    # ── Safety cap ─────────────────────────────────────────────────────
    if [[ $ITER -gt $MAX_ITERATIONS ]]; then
        NOW=$(date +%s)
        ELAPSED=$(( NOW - START_TIME ))
        HOURS=$(( ELAPSED / 3600 ))
        MINS=$(( (ELAPSED % 3600) / 60 ))
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  Hit iteration cap (${MAX_ITERATIONS}). Stopping."
        echo "  Total iterations: $(( ITER - 1 ))"
        echo "  Elapsed: ${HOURS}h ${MINS}m"
        echo "  Run: ${RUN_NAME}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        break
    fi

    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    BUILD_LOG="${LOG_DIR}/ralph_iter${ITER}_${TIMESTAMP}.log"
    REVIEW_LOG="${LOG_DIR}/review_iter${ITER}_${TIMESTAMP}.log"
    PLAN_LOG="${LOG_DIR}/plan_iter${ITER}_${TIMESTAMP}.log"
    PLAN_REVIEW_LOG="${LOG_DIR}/plan_review_iter${ITER}_${TIMESTAMP}.log"

    NOW=$(date +%s)
    ELAPSED=$(( NOW - START_TIME ))
    HOURS=$(( ELAPSED / 3600 ))
    MINS=$(( (ELAPSED % 3600) / 60 ))

    echo ""
    echo "┌───────────────────────────────────────────────────┐"
    echo "│  Iteration ${ITER} — $(date '+%H:%M:%S') — elapsed ${HOURS}h ${MINS}m"
    echo "└───────────────────────────────────────────────────┘"

    # ── Replan triggers ────────────────────────────────────────────────

    # Manual trigger: touch .ralph-replan
    if [[ -f "$REPLAN_MANUAL_FILE" ]]; then
        rm -f "$REPLAN_MANUAL_FILE"
        if [[ -f specs/PLAN.md ]]; then
            trigger_replan "manual (.ralph-replan file detected)"
        fi
    fi

    # Reviewer trigger: [REPLAN] in REVIEW.md
    if [[ "$REPLAN_ON_REVIEW" == "true" ]] && [[ -f specs/REVIEW.md ]]; then
        if grep -q "\[REPLAN\]" specs/REVIEW.md 2>/dev/null; then
            echo "  Reviewer requested replan"
            if [[ -f specs/PLAN.md ]]; then
                trigger_replan "reviewer requested [REPLAN]"
                rm -f specs/REVIEW.md 2>/dev/null || true
            fi
        fi
    fi

    # ── Drift detection (watches PLAN.md for checked-off tasks) ─────
    if [[ -f specs/PLAN.md ]]; then
        CURRENT_HASH=$(md5sum specs/PLAN.md 2>/dev/null | cut -d' ' -f1 || echo "none")
        if [[ "$CURRENT_HASH" == "$LAST_STATUS_HASH" ]]; then
            STUCK_COUNT=$(( STUCK_COUNT + 1 ))
            if [[ $STUCK_COUNT -ge $MAX_STUCK ]]; then
                echo "  WARNING: specs/PLAN.md unchanged for ${STUCK_COUNT} iterations"
                # Auto-replan on stuck
                if [[ "$REPLAN_ON_STUCK" == "true" ]]; then
                    trigger_replan "stuck for ${STUCK_COUNT} iterations"
                fi
            fi
        else
            STUCK_COUNT=0
        fi
        LAST_STATUS_HASH="$CURRENT_HASH"
        DONE_COUNT=$(grep -c "^\- \[x\]" specs/PLAN.md 2>/dev/null || echo 0)
        TODO_COUNT=$(grep -c "^\- \[ \]" specs/PLAN.md 2>/dev/null || echo 0)
        echo "  Plan: ${DONE_COUNT} done, ${TODO_COUNT} remaining"
    else
        echo "  No plan yet — planner will run"
    fi

    [[ -n "$KILL_PATTERN" ]] && pkill -f "$KILL_PATTERN" 2>/dev/null || true

    # ── PLANNING or BUILDING ──────────────────────────────────────────
    if [[ ! -f specs/PLAN.md ]]; then

        # ── PLANNING PHASE (with validation + review gate) ────────────
        PLAN_ATTEMPT=$(( PLAN_ATTEMPT + 1 ))

        if [[ $PLAN_ATTEMPT -gt $MAX_PLAN_ATTEMPTS ]]; then
            echo ""
            echo "  FATAL: Failed to produce a valid plan after ${MAX_PLAN_ATTEMPTS} attempts."
            echo "  Check specs/PLAN_REVIEW.md for details on what went wrong."
            echo "  Stopping loop."
            break
        fi

        echo "  Planner starting (attempt ${PLAN_ATTEMPT}/${MAX_PLAN_ATTEMPTS})..."
        PROMPT=$(cat specs/PLANNING_PROMPT.md)
        claude \
            --permission-mode bypassPermissions \
            --max-turns "$PLANNER_MAX_TURNS" \
            --model "$PLANNER_MODEL" \
            "$PROMPT" \
            2>&1 | tee "$PLAN_LOG"

        PLAN_EXIT=$?
        PLAN_LOG_SIZE=$(wc -c < "$PLAN_LOG" 2>/dev/null || echo 0)
        echo "  Planner exited (code ${PLAN_EXIT}, log ${PLAN_LOG_SIZE} bytes)"

        if [[ ! -f specs/PLAN.md ]]; then
            echo "  Planner did not create PLAN.md — retrying next iteration"
            sleep $PAUSE_SECONDS
            continue
        fi

        TASK_COUNT=$(grep -c "^\- \[ \]" specs/PLAN.md 2>/dev/null || echo 0)
        echo "  PLAN.md created: ${TASK_COUNT} tasks"

        # ── Step 1: Mechanical validation ─────────────────────────────
        echo ""
        echo "  Validating plan structure..."
        if ! validate_plan; then
            echo "  Plan failed mechanical validation — removing and retrying"
            rm -f specs/PLAN.md
            sleep $PAUSE_SECONDS
            continue
        fi

        # ── Step 2: AI plan review ────────────────────────────────────
        echo ""
        echo "  Plan reviewer starting..."
        [[ -n "$KILL_PATTERN" ]] && pkill -f "$KILL_PATTERN" 2>/dev/null || true

        PLAN_REVIEW_PROMPT=$(cat specs/PLAN_REVIEW_PROMPT.md)
        claude \
            --permission-mode bypassPermissions \
            --max-turns "$PLAN_REVIEW_MAX_TURNS" \
            --model "$PLAN_REVIEW_MODEL" \
            "$PLAN_REVIEW_PROMPT" \
            2>&1 | tee "$PLAN_REVIEW_LOG"

        PLAN_REVIEW_EXIT=$?
        echo "  Plan reviewer exited (code ${PLAN_REVIEW_EXIT})"

        if [[ -f specs/PLAN_REVIEW.md ]]; then
            BLOCKER_COUNT=$(grep -c "\[BLOCKER\]" specs/PLAN_REVIEW.md 2>/dev/null || echo 0)
            GAP_COUNT=$(grep -c "\[GAP\]" specs/PLAN_REVIEW.md 2>/dev/null || echo 0)
            TOO_BIG_COUNT=$(grep -c "\[TOO_BIG\]" specs/PLAN_REVIEW.md 2>/dev/null || echo 0)

            echo "  Plan review: ${BLOCKER_COUNT} blockers, ${GAP_COUNT} gaps, ${TOO_BIG_COUNT} oversized tasks"

            # Check verdict
            if grep -qi "verdict.*APPROVED" specs/PLAN_REVIEW.md 2>/dev/null; then
                echo "  Plan APPROVED by reviewer"
                PLAN_ATTEMPT=0  # Reset attempt counter on success
                rm -f specs/PLAN_REVIEW.md 2>/dev/null || true
            else
                echo "  Plan REJECTED by reviewer — removing plan for replanning"
                # Keep PLAN_REVIEW.md so the planner can read feedback
                rm -f specs/PLAN.md
                # Commit the review feedback so it survives
                git add specs/ 2>/dev/null || true
                git diff --cached --quiet 2>/dev/null || {
                    git commit -m "ralph: iteration ${ITER} — plan rejected (attempt ${PLAN_ATTEMPT})" 2>/dev/null || true
                }
                sleep $PAUSE_SECONDS
                continue
            fi
        else
            echo "  Plan reviewer did not produce PLAN_REVIEW.md — accepting plan"
            PLAN_ATTEMPT=0
        fi

        # Plan approved — commit and continue to next iteration (builder starts)
        git add specs/ 2>/dev/null || true
        git diff --cached --quiet 2>/dev/null || {
            git commit -m "ralph: iteration ${ITER} — plan approved (${TASK_COUNT} tasks)" 2>/dev/null || true
        }

    else

        # ── BUILDER PHASE ─────────────────────────────────────────────
        echo "  Builder starting..."
        PROMPT=$(cat specs/PROMPT.md)
        claude \
            --permission-mode bypassPermissions \
            --max-turns "$MAX_TURNS" \
            --model "$MODEL" \
            "$PROMPT" \
            2>&1 | tee "$BUILD_LOG"

        BUILD_EXIT=$?
        BUILD_LOG_SIZE=$(wc -c < "$BUILD_LOG" 2>/dev/null || echo 0)
        echo "  Builder exited (code ${BUILD_EXIT}, log ${BUILD_LOG_SIZE} bytes)"

        if [[ $BUILD_LOG_SIZE -lt 100 ]]; then
            echo "  Very small log — builder may have done nothing"
        fi

        # ── Check for completion ──────────────────────────────────────
        if grep -q "<promise>COMPLETE</promise>" "$BUILD_LOG" 2>/dev/null; then
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  Ralph completed all milestones!"
            echo "  Total iterations: ${ITER}"
            echo "  Elapsed: ${HOURS}h ${MINS}m"
            echo "  Run: ${RUN_NAME}"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

            git add -A && git commit -m "ralph: COMPLETE — all milestones verified" 2>/dev/null || true
            git tag "${RUN_NAME}-complete" 2>/dev/null || true

            echo "  Archiving to runs/${RUN_NAME}/..."
            mkdir -p "runs/${RUN_NAME}/output"

            for f in "${ARCHIVE_FILES[@]}"; do
                [[ -f "$f" ]] && cp -f "$f" "runs/${RUN_NAME}/output/" 2>/dev/null || true
            done
            for d in "${ARCHIVE_DIRS[@]}"; do
                if [[ -d "$d" ]]; then
                    mkdir -p "runs/${RUN_NAME}/output/${d}"
                    cp -rf "$d"/* "runs/${RUN_NAME}/output/${d}/" 2>/dev/null || true
                fi
            done

            cp -rf specs "runs/${RUN_NAME}/" 2>/dev/null || true
            cp -rf "$LOG_DIR" "runs/${RUN_NAME}/" 2>/dev/null || true

            echo "  Archived"
            break
        fi
    fi

    # ── GIT phase ─────────────────────────────────────────────────────
    [[ -n "$KILL_PATTERN" ]] && pkill -f "$KILL_PATTERN" 2>/dev/null || true

    TASK_DESC=$(get_current_task)
    COMMITTED=false
    if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]] 2>/dev/null; then
        echo "  Git: no changes"
    else
        git add -A 2>/dev/null || true
        COMMIT_MSG="ralph: iteration ${ITER} — ${TASK_DESC}"
        if git commit -m "$COMMIT_MSG" 2>/dev/null; then
            echo "  Git: committed"
            COMMITTED=true
        fi
    fi

    # ── TEST phase ────────────────────────────────────────────────────
    [[ -n "$KILL_PATTERN" ]] && pkill -f "$KILL_PATTERN" 2>/dev/null || true

    if [[ -f tests.sh ]]; then
        echo ""
        echo "  Running tests..."

        if command -v timeout &>/dev/null; then
            TEST_OUTPUT=$(timeout "$TEST_TIMEOUT" bash tests.sh 2>&1 || true)
        else
            TEST_OUTPUT=$(perl -e "alarm $ENV{TEST_TIMEOUT}; exec 'bash', 'tests.sh'" 2>&1 || true)
        fi
        TEST_EXIT=${PIPESTATUS[0]:-$?}

        PASS_COUNT=$(echo "$TEST_OUTPUT" | grep -c "PASS:" || echo 0)
        FAIL_COUNT=$(echo "$TEST_OUTPUT" | grep -c "FAIL:" || echo 0)
        if [[ $TEST_EXIT -eq 0 ]]; then
            echo "  Tests: ALL PASSED (${PASS_COUNT})"
        else
            echo "  Tests: FAILED (${PASS_COUNT} passed, ${FAIL_COUNT} failed)"
        fi

        # ── ROLLBACK on test failure ──────────────────────────────────
        if [[ $TEST_EXIT -ne 0 ]] && [[ "$COMMITTED" == "true" ]]; then
            echo "  Rolling back..."

            # Save the failed diff before reverting so builder knows what it tried
            FAILED_DIFF=$(git diff HEAD~1 2>/dev/null || echo "(diff unavailable)")

            SAVED_STATUS=$(cat specs/STATUS.md 2>/dev/null || true)
            SAVED_AGENTS=$(cat specs/AGENTS.md 2>/dev/null || true)
            SAVED_PLAN=$(cat specs/PLAN.md 2>/dev/null || true)

            git reset --hard HEAD~1 2>/dev/null || true

            [[ -n "$SAVED_STATUS" ]] && echo "$SAVED_STATUS" > specs/STATUS.md
            [[ -n "$SAVED_AGENTS" ]] && echo "$SAVED_AGENTS" > specs/AGENTS.md
            [[ -n "$SAVED_PLAN" ]] && echo "$SAVED_PLAN" > specs/PLAN.md

            # Write the failed diff so the builder can see what didn't work
            {
                echo "# Last Failed Diff"
                echo ""
                echo "This diff was attempted in iteration ${ITER} but broke tests."
                echo "Study it to understand what went wrong. Try a different approach."
                echo ""
                echo '```diff'
                echo "$FAILED_DIFF" | head -500
                echo '```'
            } > specs/LAST_FAILED_DIFF.md

            echo "  Code reverted. Specs + failed diff preserved."

            git add specs/ 2>/dev/null || true
            git diff --cached --quiet 2>/dev/null || {
                git commit -m "ralph: iteration ${ITER} — rolled back, specs preserved" 2>/dev/null || true
            }
        fi

        {
            echo "# Test Results"
            echo ""
            echo "Run at: $(date '+%Y-%m-%d %H:%M:%S') (iteration ${ITER})"
            echo "Exit code: ${TEST_EXIT}"
            echo ""
            if [[ $TEST_EXIT -eq 0 ]]; then
                echo "## Status: ALL TESTS PASSED"
            else
                echo "## Status: TESTS FAILED — CODE WAS ROLLED BACK"
                echo ""
                echo "**Your code changes from iteration ${ITER} broke tests and were reverted.**"
                echo "**Study failures below and specs/LAST_FAILED_DIFF.md, then try a different approach.**"
            fi
            echo ""
            echo "## Output"
            echo '```'
            echo "$TEST_OUTPUT"
            echo '```'
        } > specs/TEST_RESULTS.md

        git add specs/TEST_RESULTS.md 2>/dev/null || true
        git diff --cached --quiet 2>/dev/null || {
            git commit -m "ralph: iteration ${ITER} — test results" 2>/dev/null || true
        }
    fi

    # ── REVIEWER phase ────────────────────────────────────────────────
    if [[ -f specs/PLAN.md ]] && [[ $(( ITER % REVIEW_EVERY_N )) -eq 0 ]]; then
        echo ""
        echo "  Reviewer starting..."
        [[ -n "$KILL_PATTERN" ]] && pkill -f "$KILL_PATTERN" 2>/dev/null || true

        REVIEW_PROMPT=$(cat specs/REVIEW_PROMPT.md)
        claude \
            --permission-mode bypassPermissions \
            --max-turns "$REVIEWER_MAX_TURNS" \
            --model "$REVIEWER_MODEL" \
            "$REVIEW_PROMPT" \
            2>&1 | tee "$REVIEW_LOG"

        REVIEW_EXIT=$?
        echo "  Reviewer exited (code ${REVIEW_EXIT})"

        if [[ -f specs/REVIEW.md ]]; then
            BLOCKER_COUNT=$(grep -c "\[BLOCKER\]" specs/REVIEW.md 2>/dev/null || echo 0)
            WARNING_COUNT=$(grep -c "\[WARNING\]" specs/REVIEW.md 2>/dev/null || echo 0)
            REPLAN_COUNT=$(grep -c "\[REPLAN\]" specs/REVIEW.md 2>/dev/null || echo 0)
            echo "  Review: ${BLOCKER_COUNT} blockers, ${WARNING_COUNT} warnings, ${REPLAN_COUNT} replan requests"
        fi

        git add specs/ 2>/dev/null || true
        git diff --cached --quiet 2>/dev/null || {
            git commit -m "ralph: iteration ${ITER} — review" 2>/dev/null || true
        }
    else
        echo "  Reviewer skipped"
    fi

    [[ -n "$KILL_PATTERN" ]] && pkill -f "$KILL_PATTERN" 2>/dev/null || true
    sleep $PAUSE_SECONDS
done
