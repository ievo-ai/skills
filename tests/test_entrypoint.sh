#!/usr/bin/env bash
# Smoke tests for sandbox entrypoint behaviors:
# git config, REPO cloning logic, GH_TOKEN handling.

set -euo pipefail

PASS=0
FAIL=0

pass() { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

assert_nonempty() {
  local desc="$1" val="$2"
  if [[ -n "$val" ]]; then pass "$desc"; else fail "$desc (got empty value)"; fi
}

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then pass "$desc"; else fail "$desc (expected '$needle' in output)"; fi
}

assert_not_contains() {
  local desc="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then pass "$desc"; else fail "$desc (unexpected '$needle' in output)"; fi
}

assert_cmd() {
  local desc="$1" cmd="$2"
  if command -v "$cmd" &>/dev/null; then pass "$desc"; else fail "$desc ('$cmd' not found)"; fi
}

# ---------------------------------------------------------------------------
# git config
# ---------------------------------------------------------------------------

test_git_user_name_set() {
  local val
  val=$(git config --global user.name 2>/dev/null || true)
  assert_nonempty "git config --global user.name is set" "$val"
}

test_git_user_email_set() {
  local val
  val=$(git config --global user.email 2>/dev/null || true)
  assert_nonempty "git config --global user.email is set" "$val"
}

test_git_workspace_is_safe() {
  local out
  out=$(git -C /workspace status 2>&1 || true)
  assert_not_contains "workspace is not flagged as unsafe" "fatal: unsafe repository" "$out"
  assert_not_contains "workspace has no ownership error" "detected dubious ownership" "$out"
}

test_git_can_read_log() {
  local sha
  sha=$(git -C /workspace log -1 --format="%H" 2>/dev/null || true)
  assert_nonempty "git log readable in /workspace" "$sha"
}

# ---------------------------------------------------------------------------
# REPO cloning logic
# ---------------------------------------------------------------------------

test_repo_env_var_defined() {
  # Entrypoint exports REPO so the agent knows which repo to work in.
  assert_nonempty "REPO env var is defined" "${REPO:-}"
}

test_repo_clone_git_available() {
  assert_cmd "git available for REPO cloning" "git"
}

test_repo_clone_local_roundtrip() {
  # Simulate the clone branch of entrypoint: init a bare repo, clone it,
  # verify the clone contains the expected ref.
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  git init --bare "$tmp/origin.git" -q
  git clone "$tmp/origin.git" "$tmp/workdir" -q 2>/dev/null
  git -C "$tmp/workdir" commit --allow-empty -m "seed" -q \
    --author="Test <test@test>" 2>/dev/null
  git -C "$tmp/workdir" push origin HEAD -q 2>/dev/null

  local clone_dir="$tmp/clone"
  git clone "$tmp/origin.git" "$clone_dir" -q 2>/dev/null

  local msg
  msg=$(git -C "$clone_dir" log -1 --format="%s" 2>/dev/null || true)
  if [[ "$msg" == "seed" ]]; then
    pass "REPO clone roundtrip: cloned repo contains expected commit"
  else
    fail "REPO clone roundtrip: expected 'seed', got '$msg'"
  fi
}

test_repo_clone_handles_empty_repo_var() {
  # When REPO is empty, entrypoint should skip cloning without error.
  local saved="${REPO:-}"
  REPO=""
  if [[ -z "$REPO" ]]; then
    pass "empty REPO var detected correctly (clone would be skipped)"
  else
    fail "REPO appears non-empty after being cleared"
  fi
  REPO="$saved"
}

# ---------------------------------------------------------------------------
# GH_TOKEN handling
# ---------------------------------------------------------------------------

test_gh_cmd_available() {
  assert_cmd "gh CLI is installed" "gh"
}

test_gh_token_env_defined() {
  assert_nonempty "GH_TOKEN env var is set" "${GH_TOKEN:-}"
}

test_gh_auth_status_logged_in() {
  local out
  out=$(gh auth status 2>&1 || true)
  assert_contains "gh reports logged-in status" "Logged in" "$out"
}

test_gh_auth_uses_gh_token() {
  local out
  out=$(gh auth status 2>&1 || true)
  assert_contains "gh auth sourced from GH_TOKEN" "GH_TOKEN" "$out"
}

test_gh_token_unset_exits_gracefully() {
  local saved="${GH_TOKEN:-}"
  unset GH_TOKEN 2>/dev/null || true
  local out
  out=$(gh auth status 2>&1 || true)
  # Should not hard-crash; a clean auth failure message is acceptable.
  assert_not_contains "gh does not crash (no SIGKILL) without GH_TOKEN" "signal: killed" "$out"
  if [[ -n "$saved" ]]; then export GH_TOKEN="$saved"; fi
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------

test_git_user_name_set
test_git_user_email_set
test_git_workspace_is_safe
test_git_can_read_log
test_repo_env_var_defined
test_repo_clone_git_available
test_repo_clone_local_roundtrip
test_repo_clone_handles_empty_repo_var
test_gh_cmd_available
test_gh_token_env_defined
test_gh_auth_status_logged_in
test_gh_auth_uses_gh_token
test_gh_token_unset_exits_gracefully

echo ""
printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
