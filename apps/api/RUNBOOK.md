# API runbook

## Run modes

`MODE` picks what the process does. `api` is the default and serves GraphQL.

- `migrate` runs pending migrations as the migrator role (`MIGRATOR_DATABASE_URL`) and exits. On Railway it is the pre deploy command, so a failed migration stops the deploy and the old version keeps serving.
- `provision` creates the `gym_migrator` and `gym_app` roles and sets their passwords from `MIGRATOR_ROLE_PASSWORD` and `APP_ROLE_PASSWORD` (16 characters or more). It needs an administrator `DATABASE_URL`. It is safe to rerun, a rerun sets the same or new passwords.
- `onboard` adds one gym and exits. `DATABASE_URL` is the `gym_app` role. It is safe to rerun: if the subdomain already exists it changes nothing and logs `gym already exists`.

## Setting up a new database

1. Run `provision` once with an administrator `DATABASE_URL` and the two role passwords.
2. Point `DATABASE_URL` at the `gym_app` role and set `MIGRATOR_DATABASE_URL` to the `gym_migrator` role.
3. Set the pre deploy command to `MODE=migrate node dist/index.js`.

After step 1 the administrator url should not stay in the API service variables.

## Onboarding a gym

Run `MODE=onboard node dist/index.js` with these variables. Required: `GYM_NAME`, `GYM_SUBDOMAIN` (lower case letters, digits and hyphens), `GYM_TIMEZONE` (an IANA name such as `America/Toronto`), `GYM_CURRENCY` (three capital letters) and `OWNER_EMAIL`. Optional: `OWNER_NAME`, `ADMISSION_FEE` and `MONTHLY_FEE` in minor units, both defaulting to 0.

One transaction creates the gym with default settings, the owner user with the owner role, the default plan and the audit events, so a failure leaves nothing behind. Invalid input prints every problem and exits non zero without touching the database. The owner signs in later with the Google account that matches `OWNER_EMAIL`.
