import { describe, expect, it } from "vitest";
import { describeService, SERVICE_NAME } from "./service";

describe("describeService", () => {
  it("uses the default service name", () => {
    expect(describeService()).toBe(`service:${SERVICE_NAME}`);
  });

  it("uses an explicit name", () => {
    expect(describeService("worker")).toBe("service:worker");
  });
});
