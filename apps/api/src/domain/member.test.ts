import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  isMemberCode,
  MAX_BACKDATE_DAYS,
  MAX_MEMBER_NAME_LENGTH,
  type NewMemberInput,
  parseNewMember,
  parseProfileEdit,
} from "./member";

const TODAY = "2026-11-16";
const REFERRER = "11111111-1111-4111-8111-111111111111";

const valid: NewMemberInput = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  joinDate: "2026-11-16",
};

const issuesOf = (input: NewMemberInput, today = TODAY) => {
  const result = parseNewMember(input, today);
  return result.ok ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("parsing a new member", () => {
  it("normalizes the fields and takes the billing day from the join date", () => {
    const result = parseNewMember(
      {
        fullName: "  Ada Lovelace ",
        email: " Ada@Example.COM ",
        phone: " +1 (416) 555-0100 ",
        joinDate: " 2026-10-31 ",
        referredBy: REFERRER.toUpperCase(),
      },
      TODAY,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+1 (416) 555-0100",
        joinDate: "2026-10-31",
        referredBy: REFERRER,
        billingDay: 31,
      },
    });
  });

  it("leaves a blank or missing phone and referrer empty", () => {
    for (const extra of [{}, { phone: "  ", referredBy: null }, { phone: null }]) {
      expect(parseNewMember({ ...valid, ...extra }, TODAY)).toMatchObject({
        ok: true,
        value: { phone: null, referredBy: null },
      });
    }
  });

  it("accepts a join date of today and the oldest one allowed", () => {
    expect(issuesOf(valid)).toEqual([]);
    expect(issuesOf({ ...valid, joinDate: "2025-11-15" })).toEqual([]);
    expect(MAX_BACKDATE_DAYS).toBe(366);
  });

  it("reports every problem at once", () => {
    expect(
      issuesOf({
        fullName: " ",
        email: "nope",
        phone: "abc",
        joinDate: "2026-02-30",
        referredBy: "x",
      }),
    ).toEqual(["fullName", "email", "phone", "joinDate", "referredBy"]);
  });

  it("refuses a name that is too long", () => {
    expect(issuesOf({ ...valid, fullName: "n".repeat(MAX_MEMBER_NAME_LENGTH + 1) })).toEqual([
      "fullName",
    ]);
  });

  it("refuses a join date in the gym's future or more than a year back", () => {
    expect(issuesOf({ ...valid, joinDate: "2026-11-17" })).toEqual(["joinDate"]);
    expect(issuesOf({ ...valid, joinDate: "2025-11-14" })).toEqual(["joinDate"]);
  });
});

describe("member codes", () => {
  it("are six characters of uppercase letters and digits", () => {
    expect(CODE_LENGTH).toBe(6);
    expect(isMemberCode("AB12Z9")).toBe(true);
    for (const bad of ["", "ab12z9", "AB12Z", "AB12Z99", "AB 2Z9", "AB12Z-"]) {
      expect(isMemberCode(bad)).toBe(false);
    }
    expect([...CODE_ALPHABET].every((char) => isMemberCode(char.repeat(CODE_LENGTH)))).toBe(true);
  });
});

describe("parseProfileEdit", () => {
  const MEMBER_ID = "55555555-5555-4555-8555-555555555555";
  const TENANT_ID = "22222222-2222-4222-8222-222222222222";
  const PHOTO = `${TENANT_ID}/members/66666666-6666-4666-8666-666666666666.jpg`;
  const edit = (fields: Record<string, unknown>, memberId = MEMBER_ID) =>
    parseProfileEdit({ memberId, fields }, TENANT_ID);

  it("accepts a name and a phone, trimmed", () => {
    expect(edit({ name: "  Ada ", phone: " 416-555-0100 " })).toEqual({
      ok: true,
      value: { memberId: MEMBER_ID, change: { name: "Ada", phone: "416-555-0100" } },
    });
  });

  it("accepts one field alone", () => {
    expect(edit({ name: "Ada" })).toEqual({
      ok: true,
      value: { memberId: MEMBER_ID, change: { name: "Ada" } },
    });
    expect(edit({ phone: "416-555-0100" })).toEqual({
      ok: true,
      value: { memberId: MEMBER_ID, change: { phone: "416-555-0100" } },
    });
  });

  it("clears the phone with null or an empty string", () => {
    for (const phone of [null, "  "]) {
      expect(edit({ phone })).toEqual({
        ok: true,
        value: { memberId: MEMBER_ID, change: { phone: null } },
      });
    }
  });

  it("accepts a photo reference of this gym, trimmed", () => {
    for (const ext of ["jpg", "png", "webp"]) {
      const ref = PHOTO.replace(".jpg", `.${ext}`);
      expect(edit({ photoRef: ` ${ref} ` })).toEqual({
        ok: true,
        value: { memberId: MEMBER_ID, change: { photoRef: ref } },
      });
    }
  });

  it("removes the photo with null or an empty string", () => {
    for (const photoRef of [null, "  "]) {
      expect(edit({ photoRef })).toEqual({
        ok: true,
        value: { memberId: MEMBER_ID, change: { photoRef: null } },
      });
    }
  });

  it("refuses a photo reference of another gym or of the wrong shape", () => {
    const other = PHOTO.replace(TENANT_ID, "99999999-9999-4999-8999-999999999999");
    const bad = [
      other,
      PHOTO.replace("/members/", "/other/"),
      PHOTO.replace(".jpg", ".gif"),
      PHOTO.replace("66666666-6666-4666-8666-666666666666", "../secret"),
      `x${PHOTO}`,
      `${PHOTO}?x=1`,
      "https://example.test/a.jpg",
    ];
    for (const photoRef of bad) {
      const result = edit({ photoRef });
      expect(!result.ok && result.error.issues.map((issue) => issue.path)).toEqual([["photoRef"]]);
    }
  });

  it("ignores a field that was sent as undefined", () => {
    expect(edit({ name: "Ada", phone: undefined })).toEqual({
      ok: true,
      value: { memberId: MEMBER_ID, change: { name: "Ada" } },
    });
  });

  it("refuses every field outside the allow list", () => {
    const result = edit({ name: "Ada", memberNo: "AAAAAA", barcode: "BBBBBB", email: "a@b.test" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toEqual([
        { path: ["memberNo"], message: "Cannot be changed" },
        { path: ["barcode"], message: "Cannot be changed" },
        { path: ["email"], message: "Cannot be changed" },
      ]);
    }
  });

  it("refuses an edit with nothing in it", () => {
    const result = edit({});
    expect(!result.ok && result.error.issues).toEqual([{ path: [], message: "Nothing to change" }]);
  });

  it("checks the name", () => {
    const empty = edit({ name: " " });
    expect(!empty.ok && empty.error.issues).toEqual([{ path: ["name"], message: "Required" }]);
    const long = edit({ name: "x".repeat(MAX_MEMBER_NAME_LENGTH + 1) });
    expect(!long.ok && long.error.issues[0]?.path).toEqual(["name"]);
  });

  it("checks the phone", () => {
    const result = edit({ phone: "call me" });
    expect(!result.ok && result.error.issues).toEqual([
      { path: ["phone"], message: "Enter a valid phone number" },
    ]);
  });

  it("requires text where text is expected", () => {
    const result = edit({ name: 5, phone: 7, photoRef: 9 });
    expect(!result.ok && result.error.issues).toEqual([
      { path: ["name"], message: "Must be text" },
      { path: ["phone"], message: "Must be text" },
      { path: ["photoRef"], message: "Must be text" },
    ]);
  });

  it("checks the member id and reports it with the other problems", () => {
    const result = edit({ name: " " }, "nope");
    expect(!result.ok && result.error.issues.map((issue) => issue.path[0])).toEqual([
      "memberId",
      "name",
    ]);
  });
});
