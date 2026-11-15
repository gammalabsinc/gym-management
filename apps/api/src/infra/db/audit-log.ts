import { z } from "zod";
import type { AuditLog, AuditSnapshot, Clock, IdGenerator } from "../../app/ports";
import { requireTenantTx, type TenantTx } from "./tenant-tx";

const MAX_TEXT_LENGTH = 200;

const text = z.string().trim().min(1).max(MAX_TEXT_LENGTH);

const auditEventSchema = z.strictObject({
  actorUserId: z.guid().nullable(),
  action: text,
  entityType: text,
  entityId: z.guid(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  requestId: text,
});

export interface AuditLogDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** SQL null for no snapshot, so it is never stored as a JSON null. */
function toJson(snapshot: AuditSnapshot | null): string | null {
  return snapshot === null ? null : JSON.stringify(snapshot);
}

/**
 * Builds the audit port for one tenant transaction. The tenant is the transaction's, so an event
 * cannot be written for another gym, and a use case cannot name a different actor's gym either,
 * because the actor foreign key is composite with the tenant.
 */
export function makeAuditLog(tx: TenantTx, deps: AuditLogDeps): AuditLog {
  const scope = requireTenantTx(tx);
  return {
    async record(event) {
      const parsed = auditEventSchema.parse(event);
      await scope.manager.query(
        `INSERT INTO audit_events
           (tenant_id, id, occurred_at, actor_user_id, action, entity_type, entity_id, before, after, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
        [
          scope.tenantId,
          deps.ids.next(),
          deps.clock.now(),
          parsed.actorUserId,
          parsed.action,
          parsed.entityType,
          parsed.entityId,
          toJson(parsed.before),
          toJson(parsed.after),
          parsed.requestId,
        ],
      );
    },
  };
}
