import { describe, expect, it } from "vitest";
import { parseUuid } from "./uuid";

describe("parseUuid", () => {
  it("accepts a uuid, trims it and lower cases it", () => {
    const id = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    expect(parseUuid(` ${id} `, "planId")).toEqual({ ok: true, value: id.toLowerCase() });
  });

  it("names the field when the id is not a uuid", () => {
    const result = parseUuid("nope", "planId");
    expect(!result.ok && result.error.issues).toEqual([
      { path: ["planId"], message: "Invalid id" },
    ]);
  });
});
