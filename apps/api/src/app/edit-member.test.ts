import { describe, expect, it } from "vitest";
import { type EditMemberContext, MEMBER_UPDATED, makeEditMember } from "./edit-member";
import type { AuditEvent, MemberProfile, ProfileUnit } from "./ports";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_ID = "55555555-5555-4555-8555-555555555555";

const CTX: EditMemberContext = {
  roles: ["staff"],
  tenantId: TENANT_ID,
  userId: ACTOR_ID,
  requestId: "req-1",
};

const PROFILE: MemberProfile = { userId: "user-1", name: "Ada", phone: "416-555-0100" };

function harness(profile: MemberProfile | null = PROFILE) {
  const updates: { userId: string; change: object }[] = [];
  const audit: AuditEvent[] = [];
  const unit: ProfileUnit = {
    profiles: {
      lock: async () => profile,
      update: async (userId, change) => {
        updates.push({ userId, change });
      },
    },
    audit: {
      record: async (event) => {
        audit.push(event);
      },
    },
  };
  const deps = { withUnit: async <T>(_t: string, fn: (u: ProfileUnit) => Promise<T>) => fn(unit) };
  return { deps, updates, audit };
}

const edit = (fields: Record<string, unknown>) => ({ memberId: MEMBER_ID, fields });

describe("editing a member", () => {
  it("writes only the fields that changed, with one audit event", async () => {
    const h = harness();
    const result = await makeEditMember(h.deps)(
      edit({ name: " Ada L ", phone: "416-555-0100" }),
      CTX,
    );
    expect(result).toEqual({
      ok: true,
      value: { memberId: MEMBER_ID, name: "Ada L", phone: "416-555-0100", changed: true },
    });
    expect(h.updates).toEqual([{ userId: "user-1", change: { name: "Ada L" } }]);
    expect(h.audit).toEqual([
      {
        actorUserId: ACTOR_ID,
        action: MEMBER_UPDATED,
        entityType: "member",
        entityId: MEMBER_ID,
        before: { name: "Ada" },
        after: { name: "Ada L" },
        requestId: "req-1",
      },
    ]);
  });

  it("changes the phone and can clear it", async () => {
    const h = harness();
    const changed = await makeEditMember(h.deps)(edit({ phone: "647-555-0111" }), CTX);
    expect(changed.ok && changed.value.phone).toBe("647-555-0111");
    const cleared = await makeEditMember(h.deps)(edit({ phone: null }), CTX);
    expect(cleared).toEqual({
      ok: true,
      value: { memberId: MEMBER_ID, name: "Ada", phone: null, changed: true },
    });
    expect(h.audit[1]?.before).toEqual({ phone: "416-555-0100" });
    expect(h.audit[1]?.after).toEqual({ phone: null });
  });

  it("writes nothing when every value is already stored", async () => {
    const h = harness();
    const result = await makeEditMember(h.deps)(edit({ name: "Ada", phone: "416-555-0100" }), CTX);
    expect(result).toEqual({
      ok: true,
      value: { memberId: MEMBER_ID, name: "Ada", phone: "416-555-0100", changed: false },
    });
    expect(h.updates).toEqual([]);
    expect(h.audit).toEqual([]);
  });

  it("refuses fields outside the allow list before touching the database", async () => {
    const h = harness();
    const result = await makeEditMember(h.deps)(
      edit({ memberNo: "AAAAAA", barcode: "BBBBBB" }),
      CTX,
    );
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(h.updates).toEqual([]);
  });

  it("returns not found for a member of no gym here", async () => {
    const result = await makeEditMember(harness(null).deps)(edit({ name: "Ada" }), CTX);
    expect(!result.ok && result.error.kind).toBe("not_found");
  });

  it("is refused for a caller without the permission", async () => {
    const h = harness();
    const result = await makeEditMember(h.deps)(edit({ name: "Bob" }), {
      ...CTX,
      roles: ["member"],
    });
    expect(!result.ok && result.error.kind).toBe("forbidden");
    expect(h.updates).toEqual([]);
  });
});
