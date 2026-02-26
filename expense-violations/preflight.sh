#!/bin/bash
# =============================================================================
# Ralph Wiggum v4 — Preflight Check
#
# Validates environment, credentials, and memory stack files before starting.
# Initializes git repo and cleans leftover state from previous runs.
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0; FAIL=0; WARN=0
check_pass() { echo -e "  ${GREEN}✓${NC} $1"; ((PASS++)); }
check_fail() { echo -e "  ${RED}✗${NC} $1"; ((FAIL++)); }
check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ((WARN++)); }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Ralph Wiggum v4 — Preflight Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 1. Claude Code CLI ──────────────────────────────────────────────────────
echo "1. Claude Code CLI"
if command -v claude &>/dev/null; then
    check_pass "claude CLI found"
else
    check_fail "claude CLI not found → npm install -g @anthropic-ai/claude-code"
fi

# ── 2. Node.js ──────────────────────────────────────────────────────────────
echo ""
echo "2. Node.js"
if command -v node &>/dev/null; then
    check_pass "node $(node --version)"
else
    check_fail "node not found → https://nodejs.org"
fi

# ── 3. Python 3 ─────────────────────────────────────────────────────────────
echo ""
echo "3. Python"
if command -v python3 &>/dev/null; then
    check_pass "python3 $(python3 --version 2>&1 | awk '{print $2}')"
else
    check_fail "python3 not found"
fi

# ── 4. Git ───────────────────────────────────────────────────────────────────
echo ""
echo "4. Git"
if command -v git &>/dev/null; then
    check_pass "git $(git --version 2>&1 | awk '{print $3}')"
else
    check_fail "git not found"
fi

# ── 5. Extend API Credentials ──────────────────────────────────────────────
echo ""
echo "5. Extend API"
if [[ -z "${EXTEND_API_KEY}" ]]; then
    check_fail "EXTEND_API_KEY not set"
elif [[ -z "${EXTEND_API_SECRET}" ]]; then
    check_fail "EXTEND_API_SECRET not set"
else
    check_pass "EXTEND_API_KEY set (${EXTEND_API_KEY:0:10}...)"
    check_pass "EXTEND_API_SECRET set"
fi

# ── 6. Anthropic Auth ──────────────────────────────────────────────────────
echo ""
echo "6. Anthropic Auth"
if [[ -n "${ANTHROPIC_API_KEY}" ]]; then
    check_pass "ANTHROPIC_API_KEY set"
elif [[ -f "$HOME/.claude/credentials.json" ]] || [[ -f "$HOME/.config/claude/credentials.json" ]]; then
    check_pass "Claude credentials file found"
else
    check_warn "No Anthropic auth found — Claude Code may prompt you to log in"
fi

# ── 7. Port 3000 ──────────────────────────────────────────────────────────
echo ""
echo "7. Network"
if lsof -i :3000 &>/dev/null 2>&1; then
    check_warn "Port 3000 in use — Ralph will kill existing processes"
else
    check_pass "Port 3000 available"
fi

# ── 8. Memory Stack Files ─────────────────────────────────────────────────
echo ""
echo -e "8. Memory Stack ${CYAN}(v4 — Ralph-owned plan)${NC}"

REQUIRED_FILES=("PROMPT.md" "PLANNING_PROMPT.md" "REVIEW_PROMPT.md" "SPEC.md" "ARCHITECTURE.md" "STATUS.md" "CLAUDE.md" "AGENTS.md")
for f in "${REQUIRED_FILES[@]}"; do
    if [[ -f "${SCRIPT_DIR}/specs/${f}" ]]; then
        SIZE=$(wc -c < "${SCRIPT_DIR}/specs/${f}" 2>/dev/null || echo 0)
        check_pass "specs/${f} (${SIZE} bytes)"
    else
        check_fail "specs/${f} missing"
    fi
done

# ── 9. Scripts ────────────────────────────────────────────────────────────
echo ""
echo "9. Scripts"
for script in run-ralph.sh tests.sh; do
    if [[ -f "${SCRIPT_DIR}/${script}" ]]; then
        check_pass "${script}"
        if [[ -x "${SCRIPT_DIR}/${script}" ]]; then
            check_pass "${script} is executable"
        else
            check_warn "${script} not executable — run: chmod +x ${script}"
        fi
    else
        check_fail "${script} missing"
    fi
done

# ── 10. Make Clean ─────────────────────────────────────────────────────────
echo ""
echo "10. Make Clean"

HAS_GENERATED=false
if [[ -f "${SCRIPT_DIR}/server.js" ]] || [[ -f "${SCRIPT_DIR}/fetch-data.py" ]] || [[ -f "${SCRIPT_DIR}/public/index.html" ]]; then
    HAS_GENERATED=true
fi

ITER=$(cat "${SCRIPT_DIR}/.ralph-iteration" 2>/dev/null || echo "0")

if $HAS_GENERATED || [[ "$ITER" != "0" ]]; then
    echo -e "  ${YELLOW}Found leftover files from a previous run. Cleaning...${NC}"

    # Remove generated code
    rm -f "${SCRIPT_DIR}/server.js" "${SCRIPT_DIR}/fetch-data.py" "${SCRIPT_DIR}/package.json" "${SCRIPT_DIR}/package-lock.json"
    rm -f "${SCRIPT_DIR}/public/index.html"

    # Remove generated data and runtime artifacts
    rm -rf "${SCRIPT_DIR}/data" "${SCRIPT_DIR}/node_modules" "${SCRIPT_DIR}/.venv"
    rm -rf "${SCRIPT_DIR}/logs/"* "${SCRIPT_DIR}/screenshots/"*

    # Remove reviewer output and Ralph-generated plan (builder starts fresh)
    rm -f "${SCRIPT_DIR}/specs/REVIEW.md"
    rm -f "${SCRIPT_DIR}/specs/fix_plan.md"
    rm -f "${SCRIPT_DIR}/specs/TEST_RESULTS.md"

    # Reset iteration counter
    echo "0" > "${SCRIPT_DIR}/.ralph-iteration"

    # Reset MILESTONES_REFERENCE.md checkboxes if it exists: [x] → [ ]
    if [[ -f "${SCRIPT_DIR}/specs/MILESTONES_REFERENCE.md" ]]; then
        sed -i'' -e 's/- \[x\]/- [ ]/g' "${SCRIPT_DIR}/specs/MILESTONES_REFERENCE.md"
    fi

    # Reset STATUS.md to clean template
    cat > "${SCRIPT_DIR}/specs/STATUS.md" << 'STATUSEOF'
# Status: Living Document

Last updated: (not started)
Current milestone: 1
Iteration count: 0

## Progress

| Milestone | Status |
|-----------|--------|
| 1. Data Layer | ⬜ NOT STARTED |
| 2. Server + Violations + Review State | ⬜ NOT STARTED |
| 3. Dashboard Foundation + Triage Table | ⬜ NOT STARTED |
| 4. Actions + Detail Modal | ⬜ NOT STARTED |
| 5. Extend UI Design Match | ⬜ NOT STARTED |
| 6. Polish + Edge Cases | ⬜ NOT STARTED |
| 7. Responsive | ⬜ NOT STARTED |
| 8. Final QA | ⬜ NOT STARTED |

## What Exists

Nothing yet. Fresh run.

## Decisions

(none yet)

## Current Task

Starting iteration 1 — planner will generate fix_plan.md.

## Known Issues

(none yet)
STATUSEOF

    check_pass "Cleaned generated files (server.js, fetch-data.py, public/index.html, package.json)"
    check_pass "Cleaned data/, node_modules/, .venv/"
    check_pass "Cleaned logs/, screenshots/, fix_plan.md, REVIEW.md, TEST_RESULTS.md"
    check_pass "Reset iteration counter and STATUS.md"
else
    check_pass "Already clean — no generated files or stale state"
fi

# ── 11. Git Init ──────────────────────────────────────────────────────────
echo ""
echo "11. Git Repository"

cd "$SCRIPT_DIR"

if [[ -d .git ]]; then
    check_pass "Git repo already exists"
    # Clean commit any spec changes from preflight
    git add -A 2>/dev/null || true
    git diff --cached --quiet 2>/dev/null || {
        git commit -m "preflight: clean state for new run" 2>/dev/null && check_pass "Committed clean state" || true
    }
else
    # Create .gitignore
    cat > "${SCRIPT_DIR}/.gitignore" << 'GITIGNOREEOF'
node_modules/
.venv/
data/transactions.json
logs/
screenshots/
runs/
.ralph-iteration
__pycache__/
*.pyc
GITIGNOREEOF

    git init 2>/dev/null
    git add -A 2>/dev/null
    git commit -m "initial: specs and loop infrastructure" 2>/dev/null
    check_pass "Git repo initialized with initial commit"
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}  ${YELLOW}${WARN} warnings${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}Fix failures above, then re-run ./preflight.sh${NC}"
    exit 1
else
    echo -e "${GREEN}All clear. Start Ralph:${NC}"
    echo ""
    echo "  ./run-ralph.sh"
    echo ""
fi
