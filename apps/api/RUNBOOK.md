# API runbook

## Run modes

`MODE` picks what the process does. `api` is the default and serves GraphQL.

- `migrate` runs pending migrations as the migrator role (`MIGRATOR_DATABASE_URL`) and exits. On Railway it is the pre deploy command, so a failed migration stops the deploy and the old version keeps serving.
- `provision` creates the `gym_migrator` and `gym_app` roles and sets their passwords from `MIGRATOR_ROLE_PASSWORD` and `APP_ROLE_PASSWORD` (16 characters or more). It needs an administrator `DATABASE_URL`. It is safe to rerun, a rerun sets the same or new passwords.

## Setting up a new database

1. Run `provision` once with an administrator `DATABASE_URL` and the two role passwords.
2. Point `DATABASE_URL` at the `gym_app` role and set `MIGRATOR_DATABASE_URL` to the `gym_migrator` role.
3. Set the pre deploy command to `MODE=migrate node dist/index.js`.

After step 1 the administrator url should not stay in the API service variables.
