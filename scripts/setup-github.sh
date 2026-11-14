#!/usr/bin/env bash
# One time, idempotent. Run by a repo admin after the CI workflow has landed on main:
#   bash scripts/setup-github.sh [owner/repo]
# Needs the GitHub CLI, logged in with admin rights on the repo.
set -euo pipefail

repo="${1:-gammalabsinc/gym-management}"
branch="main"

command -v gh >/dev/null || { echo "gh CLI not found" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "gh is not logged in, run: gh auth login" >&2; exit 2; }

echo "Configuring merge settings on ${repo}"
gh api -X PATCH "repos/${repo}" \
  -F allow_rebase_merge=true \
  -F allow_squash_merge=false \
  -F allow_merge_commit=false \
  -F allow_auto_merge=true \
  -F allow_update_branch=true \
  -F delete_branch_on_merge=true >/dev/null

echo "Protecting ${branch}"
gh api -X PUT "repos/${repo}/branches/${branch}/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["history", "quality"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "Verifying"
settings="$(gh api "repos/${repo}")"
protection="$(gh api "repos/${repo}/branches/${branch}/protection")"

fail=0
check() { # name, jq expression, expected, source json
  local actual
  actual="$(jq -r "$2" <<<"$4")"
  if [ "$actual" != "$3" ]; then
    echo "FAIL ${1}: expected ${3}, got ${actual}" >&2
    fail=1
  else
    echo "ok   ${1}"
  fi
}

check "rebase merge on" '.allow_rebase_merge' true "$settings"
check "squash merge off" '.allow_squash_merge' false "$settings"
check "merge commit off" '.allow_merge_commit' false "$settings"
check "auto merge on" '.allow_auto_merge' true "$settings"
check "linear history" '.required_linear_history.enabled' true "$protection"
check "up to date required" '.required_status_checks.strict' true "$protection"
check "checks required" '[.required_status_checks.contexts[]] | sort | join(",")' "history,quality" "$protection"
check "applies to admins" '.enforce_admins.enabled' true "$protection"
check "force push blocked" '.allow_force_pushes.enabled' false "$protection"

exit "$fail"
