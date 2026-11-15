import type { MigrationInterface, QueryRunner } from "typeorm";
import { APP_ROLE } from "../roles";
import { TENANT_SETTING } from "../tenant-tx";

/** Business tables in creation order, so every foreign key points at a table that exists. */
const TENANT_TABLES = [
  "plans",
  "members",
  "membership_periods",
  "invoices",
  "payments",
  "payment_allocations",
  "member_discounts",
  "invoice_lines",
  "attendance",
] as const;

/** Rows are only ever added: no UPDATE, no DELETE. */
const APPEND_ONLY = ["invoice_lines", "payment_allocations", "attendance"] as const;
/** Money rows and period rows: added, and updated only by a void or by closing a period. */
const NO_DELETE = ["invoices", "payments", "membership_periods"] as const;

const POLICY = "tenant_isolation";
const CURRENT_TENANT = `nullif(current_setting('${TENANT_SETTING}', true), '')::uuid`;

/** The three void columns are all set on a void row and all null otherwise. */
const VOID_COLUMNS_CHECK = `CHECK (
  (is_void AND void_reason IS NOT NULL AND void_reason <> '' AND voided_at IS NOT NULL)
  OR (NOT is_void AND void_reason IS NULL AND voided_by IS NULL AND voided_at IS NULL)
)`;

/**
 * The business tables from the Data Model: plans, members, membership_periods, member_discounts,
 * invoices, invoice_lines, payments, payment_allocations and attendance.
 *
 * The database is the final judge of the rules the code also checks: CHECKs, composite foreign
 * keys (a row can never point at another gym's row), the two table wide unique indexes on
 * members.member_no and members.barcode, the no overlap exclusion constraint on membership_periods,
 * and triggers for the rules that span rows (money rows are never edited, allocations never exceed
 * a payment or an invoice, an invoice with counted allocations cannot be voided).
 * Row level security is enabled and forced here too, so no tenant table is ever unprotected.
 *
 * The exclusion constraint needs the btree_gist extension. It is created by the administrator when
 * roles are provisioned. IF NOT EXISTS makes this a no-op then, and fails the deploy clearly when
 * provisioning was skipped.
 */
export class BusinessTables1700000005000 implements MigrationInterface {
  name = "BusinessTables1700000005000";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    await this.createPlansAndMembers(runner);
    await this.createMembershipPeriods(runner);
    await this.createInvoicesAndPayments(runner);
    await this.createDiscountsAndLines(runner);
    await this.createAttendance(runner);
    await this.createMoneyGuards(runner);
    await this.restrictPrivileges(runner);
    await this.enableRowLevelSecurity(runner);
  }

  private async createPlansAndMembers(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE plans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        key text NOT NULL CHECK (key <> ''),
        name text NOT NULL CHECK (name <> ''),
        admission_fee int NOT NULL CHECK (admission_fee >= 0),
        monthly_fee int NOT NULL CHECK (monthly_fee >= 0),
        is_active boolean NOT NULL DEFAULT true,
        meta jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT plans_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT plans_tenant_id_key_key UNIQUE (tenant_id, key)
      )`);
    await runner.query(`
      CREATE TABLE members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        user_id uuid NOT NULL,
        member_no text NOT NULL CHECK (member_no ~ '^[A-Z0-9]{6}$'),
        barcode text NOT NULL CHECK (barcode <> ''),
        billing_day smallint NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
        referred_by uuid,
        meta jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT members_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT members_tenant_id_user_id_key UNIQUE (tenant_id, user_id),
        CONSTRAINT members_not_self_referred CHECK (referred_by IS NULL OR referred_by <> id),
        FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
        FOREIGN KEY (tenant_id, referred_by) REFERENCES members (tenant_id, id)
      )`);
    // Global on purpose: a member number and a barcode identify one person across every gym.
    // The barcode index is also the lookup index for scans.
    await runner.query("CREATE UNIQUE INDEX members_member_no_key ON members (member_no)");
    await runner.query("CREATE UNIQUE INDEX members_barcode_key ON members (barcode)");
  }

  private async createMembershipPeriods(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE membership_periods (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        member_id uuid NOT NULL,
        plan_id uuid NOT NULL,
        status text NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
        valid_from date NOT NULL,
        valid_to date,
        reason text,
        changed_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT membership_periods_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT membership_periods_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
        CONSTRAINT membership_periods_no_overlap EXCLUDE USING gist (
          tenant_id WITH =, member_id WITH =, daterange(valid_from, valid_to) WITH &&
        ),
        FOREIGN KEY (tenant_id, member_id) REFERENCES members (tenant_id, id),
        FOREIGN KEY (tenant_id, plan_id) REFERENCES plans (tenant_id, id),
        FOREIGN KEY (tenant_id, changed_by) REFERENCES users (tenant_id, id)
      )`);
    await runner.query(
      "CREATE UNIQUE INDEX membership_periods_one_current_key ON membership_periods (tenant_id, member_id) WHERE valid_to IS NULL",
    );
    await runner.query(
      "CREATE INDEX membership_periods_member_idx ON membership_periods (tenant_id, member_id, valid_from)",
    );
  }

  private async createInvoicesAndPayments(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        member_id uuid NOT NULL,
        period_start date NOT NULL,
        period_end date NOT NULL,
        due_date date NOT NULL,
        total int NOT NULL CHECK (total >= 0),
        is_void boolean NOT NULL DEFAULT false,
        void_reason text,
        voided_by uuid,
        voided_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT invoices_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT invoices_period_range CHECK (period_end >= period_start),
        CONSTRAINT invoices_due_on_period_start CHECK (due_date = period_start),
        CONSTRAINT invoices_void_columns ${VOID_COLUMNS_CHECK},
        FOREIGN KEY (tenant_id, member_id) REFERENCES members (tenant_id, id),
        FOREIGN KEY (tenant_id, voided_by) REFERENCES users (tenant_id, id)
      )`);
    // Generating twice can never create a second live invoice for the same cycle.
    await runner.query(
      "CREATE UNIQUE INDEX invoices_one_live_per_cycle_key ON invoices (tenant_id, member_id, period_start) WHERE NOT is_void",
    );
    await runner.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        member_id uuid NOT NULL,
        amount int NOT NULL CHECK (amount > 0),
        method text NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer')),
        paid_on date NOT NULL,
        submitted_at timestamptz NOT NULL DEFAULT now(),
        proof_link text,
        recorded_by uuid NOT NULL,
        client_request_id uuid NOT NULL,
        is_void boolean NOT NULL DEFAULT false,
        void_reason text,
        voided_by uuid,
        voided_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payments_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT payments_tenant_id_client_request_id_key UNIQUE (tenant_id, client_request_id),
        CONSTRAINT payments_void_columns ${VOID_COLUMNS_CHECK},
        FOREIGN KEY (tenant_id, member_id) REFERENCES members (tenant_id, id),
        FOREIGN KEY (tenant_id, recorded_by) REFERENCES users (tenant_id, id),
        FOREIGN KEY (tenant_id, voided_by) REFERENCES users (tenant_id, id)
      )`);
    await runner.query(
      "CREATE INDEX payments_member_idx ON payments (tenant_id, member_id, paid_on)",
    );
    await runner.query(`
      CREATE TABLE payment_allocations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        payment_id uuid NOT NULL,
        invoice_id uuid NOT NULL,
        amount int NOT NULL CHECK (amount > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payment_allocations_tenant_id_id_key UNIQUE (tenant_id, id),
        FOREIGN KEY (tenant_id, payment_id) REFERENCES payments (tenant_id, id),
        FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id)
      )`);
    await runner.query(
      "CREATE INDEX payment_allocations_payment_idx ON payment_allocations (tenant_id, payment_id)",
    );
    await runner.query(
      "CREATE INDEX payment_allocations_invoice_idx ON payment_allocations (tenant_id, invoice_id)",
    );
  }

  private async createDiscountsAndLines(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE member_discounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        member_id uuid NOT NULL,
        kind text NOT NULL CHECK (kind IN ('referral', 'manual')),
        referral_side text CHECK (referral_side IN ('referrer', 'referred')),
        source_member_id uuid,
        amount int NOT NULL CHECK (amount > 0),
        is_recurring boolean NOT NULL,
        reason text,
        starts_on date NOT NULL,
        ends_on date,
        consumed_invoice_id uuid,
        created_by uuid,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT member_discounts_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT member_discounts_kind_columns CHECK (
          (kind = 'manual' AND referral_side IS NULL AND source_member_id IS NULL
            AND reason IS NOT NULL AND reason <> '')
          OR (kind = 'referral' AND referral_side IS NOT NULL AND source_member_id IS NOT NULL)
        ),
        CONSTRAINT member_discounts_dates CHECK (ends_on IS NULL OR ends_on >= starts_on),
        CONSTRAINT member_discounts_consumed_is_one_time CHECK (
          consumed_invoice_id IS NULL OR NOT is_recurring
        ),
        -- The same referral can never pay out twice. Manual rows have NULLs here and never collide.
        CONSTRAINT member_discounts_referral_once_key UNIQUE (
          tenant_id, member_id, source_member_id, referral_side
        ),
        FOREIGN KEY (tenant_id, member_id) REFERENCES members (tenant_id, id),
        FOREIGN KEY (tenant_id, source_member_id) REFERENCES members (tenant_id, id),
        FOREIGN KEY (tenant_id, consumed_invoice_id) REFERENCES invoices (tenant_id, id),
        FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id)
      )`);
    await runner.query(
      "CREATE INDEX member_discounts_member_idx ON member_discounts (tenant_id, member_id, starts_on)",
    );
    await runner.query(`
      CREATE TABLE invoice_lines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        invoice_id uuid NOT NULL,
        line_type text NOT NULL CHECK (line_type IN ('membership', 'admission', 'discount')),
        description text NOT NULL CHECK (description <> ''),
        amount int NOT NULL,
        discount_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT invoice_lines_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT invoice_lines_amount_sign CHECK (
          (line_type = 'discount' AND amount < 0) OR (line_type <> 'discount' AND amount >= 0)
        ),
        CONSTRAINT invoice_lines_discount_only CHECK (line_type = 'discount' OR discount_id IS NULL),
        FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id),
        FOREIGN KEY (tenant_id, discount_id) REFERENCES member_discounts (tenant_id, id)
      )`);
    await runner.query(
      "CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (tenant_id, invoice_id)",
    );
  }

  private async createAttendance(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE attendance (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        member_id uuid NOT NULL,
        scanned_at timestamptz NOT NULL,
        local_date date NOT NULL,
        is_duplicate boolean NOT NULL,
        status_at_scan text NOT NULL CHECK (status_at_scan IN ('paid', 'due_soon', 'overdue', 'inactive')),
        source text NOT NULL CHECK (source IN ('staff_app', 'manual')),
        meta jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT attendance_tenant_id_id_key UNIQUE (tenant_id, id),
        FOREIGN KEY (tenant_id, member_id) REFERENCES members (tenant_id, id)
      )`);
    await runner.query(
      "CREATE INDEX attendance_member_idx ON attendance (tenant_id, member_id, scanned_at)",
    );
  }

  /** Triggers for the rules that look at more than one row. Each raises a check violation. */
  private async createMoneyGuards(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE FUNCTION guard_money_row() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        -- The only change a money row accepts is a void: not void to void, with the void columns.
        IF OLD.is_void OR NOT NEW.is_void THEN
          RAISE EXCEPTION '% rows are never edited, only voided', TG_TABLE_NAME
            USING ERRCODE = 'check_violation';
        END IF;
        IF to_jsonb(NEW) - 'is_void' - 'void_reason' - 'voided_by' - 'voided_at'
           IS DISTINCT FROM to_jsonb(OLD) - 'is_void' - 'void_reason' - 'voided_by' - 'voided_at' THEN
          RAISE EXCEPTION 'a void must not change other columns of %', TG_TABLE_NAME
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`
      CREATE FUNCTION guard_invoice_void() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM payment_allocations a
          JOIN payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
          WHERE a.tenant_id = NEW.tenant_id AND a.invoice_id = NEW.id AND NOT p.is_void
        ) THEN
          RAISE EXCEPTION 'an invoice with counted allocations cannot be voided, void the payment first'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`
      CREATE FUNCTION guard_allocation_caps() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        payment_amount int;
        payment_is_void boolean;
        invoice_total int;
        allocated_from_payment bigint;
        counted_on_invoice bigint;
      BEGIN
        -- Locking the two parents serialises concurrent allocations against the same payment or invoice.
        SELECT amount, is_void INTO payment_amount, payment_is_void
          FROM payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id FOR UPDATE;
        SELECT total INTO invoice_total
          FROM invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id FOR UPDATE;

        SELECT COALESCE(SUM(amount), 0) INTO allocated_from_payment
          FROM payment_allocations WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id;
        IF allocated_from_payment + NEW.amount > payment_amount THEN
          RAISE EXCEPTION 'allocations of one payment cannot exceed its amount'
            USING ERRCODE = 'check_violation';
        END IF;

        IF NOT payment_is_void THEN
          SELECT COALESCE(SUM(a.amount), 0) INTO counted_on_invoice
            FROM payment_allocations a
            JOIN payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
            WHERE a.tenant_id = NEW.tenant_id AND a.invoice_id = NEW.invoice_id AND NOT p.is_void;
          IF counted_on_invoice + NEW.amount > invoice_total THEN
            RAISE EXCEPTION 'counted allocations of one invoice cannot exceed its total'
              USING ERRCODE = 'check_violation';
          END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`
      CREATE FUNCTION guard_period_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        -- The only update a period ever gets is closing it: valid_to goes from null to a date.
        IF OLD.valid_to IS NOT NULL
           OR to_jsonb(NEW) - 'valid_to' IS DISTINCT FROM to_jsonb(OLD) - 'valid_to' THEN
          RAISE EXCEPTION 'a membership period can only be closed by setting valid_to'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $$`);
    for (const table of ["invoices", "payments"]) {
      await runner.query(
        `CREATE TRIGGER ${table}_guard_update BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION guard_money_row()`,
      );
    }
    await runner.query(
      "CREATE TRIGGER invoices_guard_void BEFORE UPDATE ON invoices FOR EACH ROW WHEN (NEW.is_void) EXECUTE FUNCTION guard_invoice_void()",
    );
    await runner.query(
      "CREATE TRIGGER payment_allocations_guard_caps BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION guard_allocation_caps()",
    );
    await runner.query(
      "CREATE TRIGGER membership_periods_guard_update BEFORE UPDATE ON membership_periods FOR EACH ROW EXECUTE FUNCTION guard_period_update()",
    );
  }

  /** The default privileges grant everything, so the stricter tables are reset to what they allow. */
  private async restrictPrivileges(runner: QueryRunner): Promise<void> {
    for (const table of APPEND_ONLY) {
      await runner.query(`REVOKE ALL ON ${table} FROM ${APP_ROLE}`);
      await runner.query(`GRANT SELECT, INSERT ON ${table} TO ${APP_ROLE}`);
    }
    for (const table of NO_DELETE) {
      await runner.query(`REVOKE ALL ON ${table} FROM ${APP_ROLE}`);
      await runner.query(`GRANT SELECT, INSERT, UPDATE ON ${table} TO ${APP_ROLE}`);
    }
  }

  private async enableRowLevelSecurity(runner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await runner.query(
        `CREATE POLICY ${POLICY} ON ${table} USING (tenant_id = ${CURRENT_TENANT}) WITH CHECK (tenant_id = ${CURRENT_TENANT})`,
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    for (const table of [...TENANT_TABLES].reverse()) {
      await runner.query(`DROP TABLE ${table}`);
    }
    for (const fn of [
      "guard_money_row",
      "guard_invoice_void",
      "guard_allocation_caps",
      "guard_period_update",
    ]) {
      await runner.query(`DROP FUNCTION ${fn}()`);
    }
  }
}
