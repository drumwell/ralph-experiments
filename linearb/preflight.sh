#!/bin/bash
# =============================================================================
# preflight.sh — Ralph Wiggum Loop — Preflight Check
#
# Validates environment, credentials, and memory stack files before starting.
# Initializes git repo and cleans leftover state from previous runs.
#
# Project-specific settings come from project.conf.
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Load project config ──────────────────────────────────────────────────────
if [[ ! -f "${SCRIPT_DIR}/project.conf" ]]; then
    echo -e "${RED}ERROR: project.conf not found in ${SCRIPT_DIR}${NC}"
    echo "Create a project.conf with your project-specific settings."
    exit 1
fi
source "${SCRIPT_DIR}/project.conf"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Ralph Wiggum — ${PROJECT_NAME} — Preflight Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Required CLI tools ─────────────────────────────────────────────────────
STEP=1
for tool in "${REQUIRED_TOOLS[@]}"; do
    echo "${STEP}. ${tool}"
    if command -v "$tool" &>/dev/null; then
        VERSION=$("$tool" --version 2>&1 | head -1 || echo "found")
        check_pass "${tool} (${VERSION})"
    else
        check_fail "${tool} not found"
    fi
    echo ""
    STEP=$((STEP + 1))
done

# ── Required environment variables ────────────────────────────────────────────
echo "${STEP}. Required Environment Variables"
for var in "${REQUIRED_ENV_VARS[@]}"; do
    if [[ -z "${!var}" ]]; then
        check_fail "${var} not set"
    else
        # Show first 10 chars for non-secret vars, just "set" for others
        if [[ "$var" == *EMAIL* ]] || [[ "$var" == *USER* ]]; then
            check_pass "${var} set (${!var})"
        else
            VAL="${!var}"
            check_pass "${var} set (${VAL:0:10}...)"
        fi
    fi
done
echo ""
STEP=$((STEP + 1))

# ── Optional environment variables ────────────────────────────────────────────
if [[ ${#OPTIONAL_ENV_VARS[@]} -gt 0 ]]; then
    echo "${STEP}. Optional Environment Variables"
    for var in "${OPTIONAL_ENV_VARS[@]}"; do
        if [[ -z "${!var}" ]]; then
            check_warn "${var} not set"
        else
            check_pass "${var} set"
        fi
    done
    echo ""
    STEP=$((STEP + 1))
fi

# ── Port availability ────────────────────────────────────────────────────────
if [[ -n "$PORT" ]]; then
    echo "${STEP}. Network"
    if lsof -i :"$PORT" &>/dev/null 2>&1; then
        check_warn "Port ${PORT} in use — Ralph will kill existing processes"
    else
        check_pass "Port ${PORT} available"
    fi
    echo ""
    STEP=$((STEP + 1))
fi

# ── Memory Stack Files ────────────────────────────────────────────────────────
echo "${STEP}. Memory Stack"

REQUIRED_FILES=("PROMPT.md" "PLANNING_PROMPT.md" "REVIEW_PROMPT.md" "SPEC.md" "ARCHITECTURE.md" "STATUS.md" "CLAUDE.md" "AGENTS.md")
for f in "${REQUIRED_FILES[@]}"; do
    if [[ -f "${SCRIPT_DIR}/specs/${f}" ]]; then
        SIZE=$(wc -c < "${SCRIPT_DIR}/specs/${f}" 2>/dev/null || echo 0)
        check_pass "specs/${f} (${SIZE} bytes)"
    else
        check_fail "specs/${f} missing"
    fi
done
echo ""
STEP=$((STEP + 1))

# ── Project-specific checks ──────────────────────────────────────────────────
if type preflight_project_checks &>/dev/null; then
    echo "${STEP}. Project Checks"
    preflight_project_checks
    echo ""
    STEP=$((STEP + 1))
fi

# ── Scripts ──────────────────────────────────────────────────────────────────
echo "${STEP}. Scripts"
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
echo ""
STEP=$((STEP + 1))

# ── Make Clean ───────────────────────────────────────────────────────────────
echo "${STEP}. Make Clean"

HAS_GENERATED=false
for f in "${GENERATED_CODE[@]}"; do
    [[ -f "${SCRIPT_DIR}/${f}" ]] && HAS_GENERATED=true && break
done

ITER=$(cat "${SCRIPT_DIR}/.ralph-iteration" 2>/dev/null || echo "0")

if $HAS_GENERATED || [[ "$ITER" != "0" ]]; then
    echo -e "  ${YELLOW}Found leftover files from a previous run. Cleaning...${NC}"

    # Remove generated code
    for f in "${GENERATED_CODE[@]}"; do
        rm -f "${SCRIPT_DIR}/${f}"
    done

    # Remove generated data
    for f in "${GENERATED_DATA[@]}"; do
        rm -f "${SCRIPT_DIR}/${f}"
    done

    # Remove generated directories
    for d in "${GENERATED_DIRS[@]}"; do
        rm -rf "${SCRIPT_DIR}/${d}"
    done

    # Remove runtime artifacts
    for d in "${RUNTIME_DIRS[@]}"; do
        rm -rf "${SCRIPT_DIR:?}/${d:?}/"*
    done

    # Remove generated specs
    for f in "${GENERATED_SPECS[@]}"; do
        rm -f "${SCRIPT_DIR}/${f}"
    done

    # Reset iteration counter
    echo "0" > "${SCRIPT_DIR}/.ralph-iteration"

    # Reset STATUS.md and AGENTS.md from project templates
    if [[ -n "$STATUS_TEMPLATE" ]]; then
        echo "$STATUS_TEMPLATE" > "${SCRIPT_DIR}/specs/STATUS.md"
    fi
    if [[ -n "$AGENTS_TEMPLATE" ]]; then
        echo "$AGENTS_TEMPLATE" > "${SCRIPT_DIR}/specs/AGENTS.md"
    fi

    check_pass "Cleaned generated files"
    check_pass "Cleaned data files and runtime directories"
    check_pass "Reset iteration counter, STATUS.md, and AGENTS.md"
else
    check_pass "Already clean — no generated files or stale state"
fi
echo ""
STEP=$((STEP + 1))

# ── Git Init ─────────────────────────────────────────────────────────────────
echo "${STEP}. Git Repository"

cd "$SCRIPT_DIR"

if [[ -d .git ]]; then
    check_pass "Git repo already exists"
    # Clean commit any spec changes from preflight
    git add -A 2>/dev/null || true
    git diff --cached --quiet 2>/dev/null || {
        git commit -m "preflight: clean state for new run" 2>/dev/null && check_pass "Committed clean state" || true
    }
else
    # Create .gitignore from project config
    printf '%s\n' "${GITIGNORE_ENTRIES[@]}" > "${SCRIPT_DIR}/.gitignore"

    git init 2>/dev/null
    git add -A 2>/dev/null
    git commit -m "initial: specs and loop infrastructure" 2>/dev/null
    check_pass "Git repo initialized with initial commit"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
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
