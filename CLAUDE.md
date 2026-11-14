# Delivery rules

This file is the single source for how work lands on main. Tickets point here instead of repeating it. Architecture rules are added by the architecture skeleton ticket (GYM-2).

## One ticket, one PR, one commit

- One Linear ticket per PR. The commit subject starts with the ticket key, for example `GYM-9: serve the schema over GraphQL Yoga`.
- A PR contains exactly one commit. To change it after review or a CI failure, `git commit --amend` and `git push --force-with-lease`. Never add fixup commits.
- Never merge main into a branch. Rebase: `git fetch origin && git rebase origin/main`.
- History on main is linear. PRs land by rebase merge only, with `gh pr merge --auto --rebase`. Squash and merge commits are disabled in the repo settings.

## Coverage

- Overall coverage is at least 90 percent for lines, branches, functions and statements, enforced by the test runner thresholds. Aim for 100 percent in the domain and app layers.
- Changed lines are at least 90 percent covered, enforced in CI by diff coverage against main. A PR that changes no executable code passes this check by design.
- Never lower a threshold, never add a file to the exclusion list to get green, never add ignore comments to skip a branch. The exclusion list is limited to generated code, migrations and the composition root, and changes to it need a human reviewer.
- Tests run against a real Postgres (`DATABASE_URL` is provided in CI). Anything that touches a tenant scoped table needs a test proving another tenant cannot see the rows.

## Required checks

Both must pass before the merge button works, and main only accepts PRs that are up to date with it:

- `history`: one commit, no merge commits, based on the tip of main (`scripts/check-history.sh`).
- `quality`: lint, typecheck, tests with coverage, diff coverage. Root `package.json` must provide the scripts `lint`, `typecheck` and `test:coverage`. `test:coverage` runs every workspace and writes one merged `coverage/lcov.info` with paths relative to the repo root.

## When CI fails

Fix with an amend and a lease push. After two failed attempts, stop: label the ticket `needs-human`, comment with the failing check and what was tried, and move on to the next ticket.

## GitHub settings

`scripts/setup-github.sh` applies and verifies the repo settings (rebase merge only, linear history, required checks, up to date branches, auto merge). Re-run it after any settings drift.
