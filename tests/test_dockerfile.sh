#!/usr/bin/env bash
# Verify that every tool expected in the sandbox image is present and functional.
# On Debian/Ubuntu systems, fd-find is installed as 'fdfind'; both names are checked.

set -euo pipefail

PASS=0
FAIL=0

pass() { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

assert_cmd() {
  # Accepts one or more candidate names; passes if any resolves.
  local desc="$1"; shift
  local found=""
  for cmd in "$@"; do
    if command -v "$cmd" &>/dev/null; then found="$cmd"; break; fi
  done
  if [[ -n "$found" ]]; then
    pass "$desc ($(command -v "$found"))"
  else
    fail "$desc (none of: $*)"
  fi
}

assert_version_flag() {
  local tool="$1" flag="${2:---version}"
  if "$tool" "$flag" &>/dev/null; then
    pass "$tool $flag exits 0"
  else
    fail "$tool $flag non-zero exit"
  fi
}

assert_min_version() {
  # Compare semver major.minor only; pass if actual >= min.
  local tool="$1" min_major="$2" min_minor="$3"
  local raw actual_major actual_minor
  raw=$("$tool" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || true)
  actual_major=$(echo "$raw" | cut -d. -f1)
  actual_minor=$(echo "$raw" | cut -d. -f2)
  if [[ "$actual_major" -gt "$min_major" ]] || \
     { [[ "$actual_major" -eq "$min_major" ]] && [[ "$actual_minor" -ge "$min_minor" ]]; }; then
    pass "$tool version $raw >= $min_major.$min_minor"
  else
    fail "$tool version $raw is below minimum $min_major.$min_minor"
  fi
}

# ---------------------------------------------------------------------------
# Presence checks
# ---------------------------------------------------------------------------

assert_cmd "git is installed"    git
assert_cmd "node is installed"   node nodejs
assert_cmd "python3 is installed" python3
assert_cmd "gh CLI is installed" gh
assert_cmd "claude is installed" claude
assert_cmd "codex is installed"  codex
assert_cmd "jq is installed"     jq
assert_cmd "rg (ripgrep) is installed" rg
# fd-find ships as 'fdfind' on Debian/Ubuntu; accept either name.
assert_cmd "fd (fd-find) is installed" fd fdfind

# ---------------------------------------------------------------------------
# Executable and --version sanity checks
# ---------------------------------------------------------------------------

assert_version_flag git   --version
assert_version_flag node  --version
assert_version_flag python3 --version
assert_version_flag jq    --version
assert_version_flag rg    --version

# gh version flag
if gh version &>/dev/null; then
  pass "gh version exits 0"
else
  fail "gh version non-zero exit"
fi

# ---------------------------------------------------------------------------
# Minimum version guards
# ---------------------------------------------------------------------------

assert_min_version git    2 30
assert_min_version node   18 0
assert_min_version python3 3 8
assert_min_version rg     13 0

# ---------------------------------------------------------------------------
# Functional smoke tests
# ---------------------------------------------------------------------------

test_node_can_run_script() {
  local out
  out=$(node -e 'process.stdout.write("ok\n")' 2>/dev/null || true)
  if [[ "$out" == "ok" ]]; then
    pass "node executes inline script"
  else
    fail "node inline script failed (got '$out')"
  fi
}

test_python3_can_run_script() {
  local out
  out=$(python3 -c 'print("ok")' 2>/dev/null || true)
  if [[ "$out" == "ok" ]]; then
    pass "python3 executes inline script"
  else
    fail "python3 inline script failed (got '$out')"
  fi
}

test_jq_can_parse_json() {
  local out
  out=$(echo '{"k":"v"}' | jq -r '.k' 2>/dev/null || true)
  if [[ "$out" == "v" ]]; then
    pass "jq parses JSON correctly"
  else
    fail "jq JSON parse failed (got '$out')"
  fi
}

test_rg_can_search_file() {
  local tmp out
  tmp=$(mktemp)
  printf 'hello world\n' > "$tmp"
  out=$(rg "hello" "$tmp" 2>/dev/null || true)
  rm -f "$tmp"
  if [[ "$out" == *"hello"* ]]; then
    pass "rg searches file contents"
  else
    fail "rg search failed (got '$out')"
  fi
}

test_fd_or_fdfind_finds_files() {
  local tmp out fd_cmd
  tmp=$(mktemp -d)
  touch "$tmp/target.txt"
  fd_cmd=$(command -v fd 2>/dev/null || command -v fdfind 2>/dev/null || true)
  if [[ -z "$fd_cmd" ]]; then
    fail "fd/fdfind: no binary found"
  else
    out=$("$fd_cmd" --type f . "$tmp" 2>/dev/null || true)
    if [[ "$out" == *"target.txt"* ]]; then
      pass "fd/fdfind finds files in directory"
    else
      fail "fd/fdfind did not find expected file (got '$out')"
    fi
  fi
  rm -rf "$tmp"
}

test_git_can_init_repo() {
  local tmp
  tmp=$(mktemp -d)
  git init "$tmp/repo" -q 2>/dev/null
  if [[ -d "$tmp/repo/.git" ]]; then
    pass "git init creates .git directory"
  else
    fail "git init did not create .git directory"
  fi
  rm -rf "$tmp"
}

# ---------------------------------------------------------------------------
# Run functional tests
# ---------------------------------------------------------------------------

test_node_can_run_script
test_python3_can_run_script
test_jq_can_parse_json
test_rg_can_search_file
test_fd_or_fdfind_finds_files
test_git_can_init_repo

echo ""
printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
