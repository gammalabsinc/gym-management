import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The staff user who made a check in, so a check in by search says who picked the member from the
 * list. It is null for rows written before this column existed. The foreign key names the tenant
 * too, so a user of another gym can never be recorded. The table stays append only.
 */
export class AttendanceRecordedBy1700000008000 implements MigrationInterface {
  name = "AttendanceRecordedBy1700000008000";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE attendance ADD COLUMN recorded_by uuid");
    await runner.query(
      `ALTER TABLE attendance ADD CONSTRAINT attendance_recorded_by_fkey
         FOREIGN KEY (tenant_id, recorded_by) REFERENCES users (tenant_id, id)`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE attendance DROP COLUMN recorded_by");
  }
}
