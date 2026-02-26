#!/bin/bash
# =============================================================================
# Ralph Wiggum v2 — Preflight Check
#
# Validates environment, credentials, and memory stack files before starting.
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
echo "  Ralph Wiggum v2 — Preflight Check"
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

# ── 4. Extend API Credentials ──────────────────────────────────────────────
echo ""
echo "4. Extend API"
if [[ -z "${EXTEND_API_KEY}" ]]; then
    check_fail "EXTEND_API_KEY not set"
elif [[ -z "${EXTEND_API_SECRET}" ]]; then
    check_fail "EXTEND_API_SECRET not set"
else
    check_pass "EXTEND_API_KEY set (${EXTEND_API_KEY:0:10}...)"
    check_pass "EXTEND_API_SECRET set"
fi

# ── 5. Anthropic Auth ──────────────────────────────────────────────────────
echo ""
echo "5. Anthropic Auth"
if [[ -n "${ANTHROPIC_API_KEY}" ]]; then
    check_pass "ANTHROPIC_API_KEY set"
elif [[ -f "$HOME/.claude/credentials.json" ]] || [[ -f "$HOME/.config/claude/credentials.json" ]]; then
    check_pass "Claude credentials file found"
else
    check_warn "No Anthropic auth found — Claude Code may prompt you to log in"
fi

# ── 6. Port 3000 ──────────────────────────────────────────────────────────
echo ""
echo "6. Network"
if lsof -i :3000 &>/dev/null 2>&1; then
    check_warn "Port 3000 in use — Ralph will kill existing processes"
else
    check_pass "Port 3000 available"
fi

# ── 7. Memory Stack Files ─────────────────────────────────────────────────
echo ""
echo -e "7. Memory Stack ${CYAN}(v2 — Codex-style)${NC}"

REQUIRED_FILES=("PROMPT.md" "SPEC.md" "PLAN.md" "ARCHITECTURE.md" "STATUS.md" "CLAUDE.md" "AGENTS.md")
for f in "${REQUIRED_FILES[@]}"; do
    if [[ -f "${SCRIPT_DIR}/specs/${f}" ]]; then
        SIZE=$(wc -c < "${SCRIPT_DIR}/specs/${f}" 2>/dev/null || echo 0)
        check_pass "specs/${f} (${SIZE} bytes)"
    else
        check_fail "specs/${f} missing"
    fi
done

# ── 8. Scripts ────────────────────────────────────────────────────────────
echo ""
echo "8. Scripts"
[[ -f "${SCRIPT_DIR}/run-ralph.sh" ]] && check_pass "run-ralph.sh" || check_fail "run-ralph.sh missing"
[[ -x "${SCRIPT_DIR}/run-ralph.sh" ]] && check_pass "run-ralph.sh is executable" || check_warn "run-ralph.sh not executable — run: chmod +x run-ralph.sh"

# ── 9. Clean State ────────────────────────────────────────────────────────
echo ""
echo "9. Clean State"
if [[ -f "${SCRIPT_DIR}/server.js" ]] || [[ -f "${SCRIPT_DIR}/fetch-data.py" ]] || [[ -f "${SCRIPT_DIR}/public/index.html" ]]; then
    check_warn "Generated code files exist from previous run — Ralph will overwrite them"
else
    check_pass "Clean slate — no generated code files"
fi

ITER=$(cat "${SCRIPT_DIR}/.ralph-iteration" 2>/dev/null || echo "0")
if [[ "$ITER" != "0" ]]; then
    check_warn "Iteration counter at ${ITER} — reset with: echo 0 > .ralph-iteration"
else
    check_pass "Iteration counter at 0"
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
    echo "  # Optional: reset for clean run"
    echo "  echo 0 > .ralph-iteration"
    echo "  rm -f server.js fetch-data.py public/index.html package.json"
    echo "  rm -rf data/ logs/ node_modules/"
    echo ""
    echo "  # Start the loop"
    echo "  ./run-ralph.sh"
    echo ""
fi
