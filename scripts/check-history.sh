#!/usr/bin/env bash
# Fails unless the head ref is exactly one non merge commit on top of the tip of the base ref.
# Usage: check-history.sh <base-ref> <head-ref>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <base-ref> <head-ref>" >&2
  exit 2
fi

base="$1"
head="$2"

for ref in "$base" "$head"; do
  if ! git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null; then
    echo "::error::ref '${ref}' does not resolve to a commit (shallow checkout? use fetch-depth: 0)"
    exit 2
  fi
done

ahead="$(git rev-list --count "${base}..${head}")"
behind="$(git rev-list --count "${head}..${base}")"
merges="$(git rev-list --count --merges "${base}..${head}")"

status=0

if [ "$merges" -ne 0 ]; then
  echo "::error::branch contains ${merges} merge commit(s). Rebase instead of merging."
  status=1
fi

if [ "$ahead" -ne 1 ]; then
  echo "::error::branch has ${ahead} commit(s) ahead of base, expected exactly 1. Amend and force push with lease, do not add fixup commits."
  status=1
fi

if [ "$behind" -ne 0 ]; then
  echo "::error::branch is ${behind} commit(s) behind base. Rebase onto the latest base."
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "history ok: 1 commit, no merges, up to date with base"
fi

exit "$status"
