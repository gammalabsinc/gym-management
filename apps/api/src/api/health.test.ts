import { describe, expect, it } from "vitest";
import { routeRequest } from "./health";

describe("routeRequest", () => {
  it("answers the health check", () => {
    expect(routeRequest("GET", "/healthz")).toEqual({ status: 200, body: { status: "ok" } });
  });

  it("ignores the query string", () => {
    expect(routeRequest("GET", "/healthz?probe=1").status).toBe(200);
  });

  it("rejects other methods on the health path", () => {
    expect(routeRequest("POST", "/healthz")).toEqual({
      status: 405,
      body: { error: "method_not_allowed" },
    });
    expect(routeRequest(undefined, "/healthz").status).toBe(405);
  });

  it("returns not found for every other path", () => {
    expect(routeRequest("GET", "/nope")).toEqual({ status: 404, body: { error: "not_found" } });
    expect(routeRequest("GET", undefined).status).toBe(404);
  });
});
