import { describe, expect, it } from "vitest";
import { appIdentity, BASE_APP_ID } from "./app-identity";

describe("appIdentity", () => {
  it("gives production the plain app id and name", () => {
    expect(appIdentity("production")).toEqual({ appId: BASE_APP_ID, name: "Gym" });
  });

  it("gives internal builds a suffixed id and name so they cannot be confused", () => {
    expect(appIdentity("internal")).toEqual({
      appId: `${BASE_APP_ID}.internal`,
      name: "Gym (internal)",
    });
  });

  it("keeps development apart from both", () => {
    const ids = ["development", "internal", "production"].map(
      (profile) => appIdentity(profile as "internal").appId,
    );
    expect(new Set(ids).size).toBe(3);
  });
});
