import { describe, expect, it } from "vitest";
import { parseBackfillFile } from "./backfill-file";

describe("parseBackfillFile", () => {
  it("reads members and fills the empty lists", () => {
    const result = parseBackfillFile(
      JSON.stringify({ members: [{ email: "a@x.test", fullName: "Ada", joinDate: "2026-01-05" }] }),
    );
    expect(result).toEqual({
      ok: true,
      value: [
        {
          email: "a@x.test",
          fullName: "Ada",
          joinDate: "2026-01-05",
          statusHistory: [],
          payments: [],
          discounts: [],
        },
      ],
    });
  });

  it("refuses text that is not JSON", () => {
    const result = parseBackfillFile("{nope");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.issues).toEqual([{ path: [], message: "The file is not valid JSON" }]);
  });

  it("names a misspelled field and where it is", () => {
    const result = parseBackfillFile(
      JSON.stringify({
        members: [{ email: "a@x.test", fullName: "Ada", joinDate: "2026-01-05", fulName: "x" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues[0]?.path).toEqual(["members", 0]);
  });
});
