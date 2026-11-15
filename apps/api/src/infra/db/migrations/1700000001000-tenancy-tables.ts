import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The tenancy tables from the Data Model: tenants, users and user_roles. Roles are hardcoded for
 * the MVP, so there is no roles table, and permissions come from a shared code module.
 * Every foreign key between tenant tables is composite, so a row can never point at another
 * gym's row. Row level security comes in its own migration.
 */
export class TenancyTables1700000001000 implements MigrationInterface {
  name = "TenancyTables1700000001000";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        subdomain text NOT NULL UNIQUE,
        timezone text NOT NULL CHECK (timezone <> ''),
        currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        branding jsonb NOT NULL DEFAULT '{}',
        settings jsonb NOT NULL DEFAULT '{"warn_days_before": 5, "red_days_after": 5, "dup_window_min": 10}',
        is_active boolean NOT NULL DEFAULT true,
        meta jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await runner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        email text NOT NULL CHECK (email = lower(email)),
        name text,
        phone text,
        photo_ref text,
        auth_provider text NOT NULL DEFAULT 'google',
        auth_subject text,
        is_active boolean NOT NULL DEFAULT true,
        meta jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT users_tenant_id_email_key UNIQUE (tenant_id, email),
        CONSTRAINT users_tenant_id_auth_subject_key UNIQUE (tenant_id, auth_subject)
      )`);
    await runner.query(`
      CREATE TABLE user_roles (
        tenant_id uuid NOT NULL,
        user_id uuid NOT NULL,
        role text NOT NULL CHECK (role IN ('owner', 'staff', 'member')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id, role),
        FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
      )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("DROP TABLE user_roles");
    await runner.query("DROP TABLE users");
    await runner.query("DROP TABLE tenants");
  }
}
