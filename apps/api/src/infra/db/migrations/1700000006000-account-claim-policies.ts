import type { MigrationInterface, QueryRunner } from "typeorm";
import { CLAIM_EMAIL_SETTING, CLAIM_SUBJECT_SETTING } from "../claim-settings";

const EMAIL = `nullif(current_setting('${CLAIM_EMAIL_SETTING}', true), '')`;
const SUBJECT = `nullif(current_setting('${CLAIM_SUBJECT_SETTING}', true), '')`;

/**
 * A person signing in for the first time is in no gym yet, so the tenant policy shows them nothing.
 * These two policies are added to it (policies on a table are combined with OR) and are as narrow
 * as the claim allows:
 *
 * - read: the rows that already belong to the signing in subject, and the unlinked rows added for
 *   the verified email.
 * - link: only an unlinked row with that email can be updated, and only into a row that carries
 *   that email and that subject. A row linked to anyone else is out of reach, and so is every row
 *   with another email.
 *
 * With no claim settings, which is every request except a sign in, both policies match nothing.
 */
export class AccountClaimPolicies1700000006000 implements MigrationInterface {
  name = "AccountClaimPolicies1700000006000";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE POLICY account_claim_read ON users FOR SELECT
        USING (
          (auth_subject IS NOT NULL AND auth_subject = ${SUBJECT})
          OR (auth_subject IS NULL AND email = ${EMAIL})
        )`);
    await runner.query(`
      CREATE POLICY account_claim_link ON users FOR UPDATE
        USING (auth_subject IS NULL AND email = ${EMAIL})
        WITH CHECK (auth_subject = ${SUBJECT} AND email = ${EMAIL})`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("DROP POLICY account_claim_link ON users");
    await runner.query("DROP POLICY account_claim_read ON users");
  }
}
