# gym-management

Multi-tenant gym management system. The application code has not landed yet; this repository currently holds the delivery rules and the CI gates every change must pass.

## Repository layout

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | Delivery rules: one ticket per PR, one commit per PR, coverage, required checks. The single source of truth for how work lands on `main`. |
| `.github/workflows/ci.yml` | Runs the `history` and `quality` required checks on every pull request to `main`. |
| `scripts/check-history.sh` | Backs the `history` check: exactly one non-merge commit on top of the tip of the base branch. |
| `scripts/setup-github.sh` | Applies and verifies the repository settings (rebase merge only, linear history, required checks, auto merge). Needs an admin `gh` login. |

## Prerequisites

- Node.js 22 and pnpm (version pinned by the `packageManager` field in `package.json`)
- PostgreSQL 16, reachable through `DATABASE_URL`, for the test suite
- GitHub CLI and `jq`, only to run `scripts/setup-github.sh`

## Common tasks

Check a branch's history locally before pushing:

```bash
git fetch origin && bash scripts/check-history.sh origin/main HEAD
```

Apply or re-verify the GitHub settings (repo admin only):

```bash
bash scripts/setup-github.sh gammalabsinc/gym-management
```

The `quality` check expects root `package.json` scripts `lint`, `typecheck` and `test:coverage`. Until they exist that check fails closed by design.

## Contributing

Read `CLAUDE.md` before opening a pull request. Pull requests that break its rules fail the required checks.
