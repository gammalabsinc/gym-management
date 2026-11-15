/**
 * The Postgres settings a sign in transaction sets so the account claim policies can see it.
 * Like app.tenant_id they are set per transaction, so they vanish when it ends.
 */
export const CLAIM_EMAIL_SETTING = "app.claim_email";
export const CLAIM_SUBJECT_SETTING = "app.claim_subject";
