# Database restore runbook

There is one environment, production, and no staging. This runbook restores a backup of the production Postgres on Railway into a new, throwaway database, checks it, and covers what to do if production is lost. A drill never touches the production database.

Never restore over production unless production is already lost and you are on the "Production is lost" path below.

## What you need

- Access to the Railway project that holds the API and its Postgres service.
- The Railway CLI logged in (`railway login`) and linked to the project (`railway link`).
- `pg_dump`, `pg_restore` and `psql` version 16 or newer on your machine. Check with `psql --version`.
- The `gym_migrator` and `gym_app` role passwords. They are the `MIGRATOR_ROLE_PASSWORD` and `APP_ROLE_PASSWORD` variables, set when the database was provisioned (see `apps/api/RUNBOOK.md`).

Keep connection strings out of shell history and out of this repo. Export them in your shell for the session only.

## 1. Take a manual backup

Do this before any risky change and at the start of every drill.

1. In Railway open the Postgres service, then the Variables tab, and copy `DATABASE_PUBLIC_URL`. This is the administrator url.
2. Run:

   ```bash
   export PROD_ADMIN_URL='<DATABASE_PUBLIC_URL>'
   STAMP=$(date -u +%Y%m%dT%H%M%SZ)
   pg_dump --format=custom --no-owner --file="gym-$STAMP.dump" "$PROD_ADMIN_URL"
   ls -lh "gym-$STAMP.dump"
   ```

   `--no-owner` is deliberate: the restore assigns ownership to the migrator role. Grants and row level security settings stay in the dump, so the restored database keeps the same access rules. The roles themselves are not in a dump, which is why step 2.3 creates them first.
3. Store the dump somewhere private and encrypted, not in the repo. A dump holds member data.

Railway also keeps its own volume backups. Open the Postgres service, then the Backups tab, to see the schedule and the list of backups, and use Backup now for an extra one. A Railway volume restore replaces the volume it is run against, so do not use it for a drill. Use the dump above.

## 2. Restore into a throwaway database

1. In the Railway project choose New, then Database, then Add PostgreSQL. Rename the new service `restore-drill-<date>` so it cannot be mistaken for production.
2. Open the new service, Variables tab, and copy its `DATABASE_PUBLIC_URL`:

   ```bash
   export DRILL_ADMIN_URL='<drill DATABASE_PUBLIC_URL>'
   test "$DRILL_ADMIN_URL" != "$PROD_ADMIN_URL" || echo 'STOP: drill url equals production url'
   ```

   If the last line prints STOP, do not continue.
3. Create the roles on the drill database. From the repo root, build the API, then run provision against the drill database:

   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @gym/api run build
   DATABASE_URL="$DRILL_ADMIN_URL" MIGRATOR_ROLE_PASSWORD='<16+ chars>' APP_ROLE_PASSWORD='<16+ chars>' MODE=provision node apps/api/dist/index.js
   ```
4. Time the restore. Start the clock, then:

   ```bash
   time pg_restore --no-owner --role=gym_migrator --dbname="$DRILL_ADMIN_URL" "gym-$STAMP.dump"
   ```

   If `pg_restore` reports that `gym_migrator` cannot create objects in the schema, run `psql "$DRILL_ADMIN_URL" -c 'GRANT ALL ON SCHEMA public TO gym_migrator'` and repeat the restore into a fresh database.
5. Confirm the schema is current by running migrations as the migrator role. The restored database carries its migration history, so this does nothing when the backup was taken at the current version, and applies the missing ones when it was older:

   ```bash
   DATABASE_URL='<drill gym_app url>' MIGRATOR_DATABASE_URL='<drill gym_migrator url>' MODE=migrate node apps/api/dist/index.js
   ```

## 3. Check the restored data

Connect with `psql "$DRILL_ADMIN_URL"`. Run these checks on the drill database and on production, then compare. Row counts may differ only by writes made between the backup and the check.

1. Row counts per table:

   ```sql
   SELECT 'tenants' AS t, count(*) FROM tenants
   UNION ALL SELECT 'users', count(*) FROM users
   UNION ALL SELECT 'user_roles', count(*) FROM user_roles
   UNION ALL SELECT 'plans', count(*) FROM plans
   UNION ALL SELECT 'members', count(*) FROM members
   UNION ALL SELECT 'membership_periods', count(*) FROM membership_periods
   UNION ALL SELECT 'invoices', count(*) FROM invoices
   UNION ALL SELECT 'invoice_lines', count(*) FROM invoice_lines
   UNION ALL SELECT 'payments', count(*) FROM payments
   UNION ALL SELECT 'payment_allocations', count(*) FROM payment_allocations
   UNION ALL SELECT 'member_discounts', count(*) FROM member_discounts
   UNION ALL SELECT 'attendance', count(*) FROM attendance
   UNION ALL SELECT 'audit_events', count(*) FROM audit_events
   UNION ALL SELECT 'sessions', count(*) FROM sessions;
   ```
2. Tenant isolation spot check. Connect as the app role (`gym_app`) and confirm that without a tenant set you see nothing, and with one tenant set you see only that tenant:

   ```sql
   SELECT count(*) FROM members;                                  -- expect 0
   SELECT set_config('app.tenant_id', '<one tenant id>', false);
   SELECT count(*) FROM members;                                  -- expect that gym's member count
   SELECT count(*) FROM members WHERE tenant_id <> '<one tenant id>'; -- expect 0
   ```
3. The audit trail is intact and still append only, connected as `gym_app`:

   ```sql
   SELECT set_config('app.tenant_id', '<one tenant id>', false);
   SELECT count(*), min(occurred_at), max(occurred_at) FROM audit_events;
   UPDATE audit_events SET action = action WHERE false;   -- expect: permission denied
   ```
4. Money still adds up. No payment may be allocated for more than its amount. Run this as the administrator. If it returns any row, stop and treat the backup as suspect:

   ```sql
   SELECT p.id FROM payments p
   JOIN payment_allocations a ON a.tenant_id = p.tenant_id AND a.payment_id = p.id
   GROUP BY p.id, p.amount
   HAVING sum(a.amount) > p.amount;
   ```

The restore passes when all four checks give the expected result. Write down the elapsed time from step 2.4.

## 4. Clean up the drill

1. In Railway open the `restore-drill-<date>` service, Settings, then Delete Service.
2. Delete the local dump unless you need it: `shred -u "gym-$STAMP.dump"` or your platform's secure delete.
3. Unset the variables: `unset PROD_ADMIN_URL DRILL_ADMIN_URL`.

## Production is lost

Use this path only when the production database is gone or corrupt and you have decided to recover.

1. Say so in the team channel and stop deploys. Take the API service down by setting its replica count to 0 in Railway, so nothing writes to a bad database.
2. Pick the newest good backup: the Railway Backups tab, or the newest dump from step 1. Note how much data after it will be lost.
3. Create a new Postgres service, then follow steps 2 and 3 above with the new service as the target. Do not delete the broken service yet, keep it for forensics.
4. Point the API at the new database. On the API service set `DATABASE_URL` to the new `gym_app` url and `MIGRATOR_DATABASE_URL` to the new `gym_migrator` url, then redeploy. The pre deploy command runs `MODE=migrate`.
5. Scale the API back to its normal replica count. Open the app and check one gym end to end: sign in, open the customers list, record a scan.
6. Tell gym owners what time window of data was lost. Delete the broken service only after the owner agrees.

## Drill log

Fill in one row after each drill. The first drill closes GYM-29.

| Date (UTC) | Backup used | Dump size | Restore time (step 2.4) | Checks 3.1 to 3.4 | Run by | Result and notes |
| ---------- | ----------- | --------- | ----------------------- | ----------------- | ------ | ---------------- |
|            |             |           |                         |                   |        |                  |
