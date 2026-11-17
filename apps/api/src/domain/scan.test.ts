import { describe, expect, it } from "vitest";
import { MAX_BARCODE_LENGTH, parseRecordScan } from "./scan";

describe("parseRecordScan", () => {
  it("trims the barcode and defaults the source to the staff app", () => {
    expect(parseRecordScan({ barcode: "  K7M2QX " })).toEqual({
      ok: true,
      value: { barcode: "K7M2QX", source: "staff_app" },
    });
  });

  it("treats a blank or missing source as the default", () => {
    for (const source of ["", "  ", null, undefined]) {
      const parsed = parseRecordScan({ barcode: "ABC", source });
      expect(parsed.ok && parsed.value.source).toBe("staff_app");
    }
  });

  it("accepts the manual source", () => {
    const parsed = parseRecordScan({ barcode: "ABC", source: " manual " });
    expect(parsed.ok && parsed.value.source).toBe("manual");
  });

  it("accepts any text of a sensible length, so a random string reaches the lookup", () => {
    const parsed = parseRecordScan({ barcode: "not-a-code 123 %_'" });
    expect(parsed.ok).toBe(true);
  });

  it("accepts the longest barcode and refuses one character more", () => {
    expect(parseRecordScan({ barcode: "a".repeat(MAX_BARCODE_LENGTH) }).ok).toBe(true);
    const tooLong = parseRecordScan({ barcode: "a".repeat(MAX_BARCODE_LENGTH + 1) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.issues[0]?.path).toEqual(["barcode"]);
  });

  it("refuses an empty barcode", () => {
    const parsed = parseRecordScan({ barcode: "   " });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.issues[0]?.path).toEqual(["barcode"]);
  });

  it("refuses an unknown source and reports every problem", () => {
    const parsed = parseRecordScan({ barcode: "", source: "kiosk" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.issues.map((i) => i.path[0])).toEqual(["barcode", "source"]);
  });
});
