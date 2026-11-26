import { describe, expect, it, vi } from "vitest";
import type { Client } from "../api/client";
import {
  createMembersService,
  LOAD_FAILED_MESSAGE,
  REFERRER_LIMIT,
  SAVE_FAILED_MESSAGE,
} from "./service";

function svc(outcome: unknown) {
  const execute = vi.fn(async () => outcome);
  const client = { execute } as unknown as Pick<Client, "execute">;
  return { service: createMembersService({ client }), execute };
}

const network = { status: "network", message: "offline" };
const forbidden = { status: "error", error: { code: "FORBIDDEN", message: "no" } };
const broken = { status: "error", error: { code: "INTERNAL", message: "boom" } };

describe("loadFees", () => {
  const data = {
    plans: [
      { id: "old", name: "Old", admissionFee: 1, monthlyFee: 1, isActive: false },
      { id: "p1", name: "Standard", admissionFee: 5000, monthlyFee: 8000, isActive: true },
    ],
    tenant: { currency: "USD", timezone: "America/Toronto" },
  };

  it("reads the active plan's current fees", async () => {
    const { service } = svc({ status: "data", data });
    expect(await service.loadFees()).toEqual({
      status: "loaded",
      data: {
        planId: "p1",
        planName: "Standard",
        currency: "USD",
        timezone: "America/Toronto",
        admissionFee: 5000,
        monthlyFee: 8000,
      },
    });
  });

  it("fails when there is no active plan", async () => {
    const { service } = svc({ status: "data", data: { ...data, plans: [data.plans[0]] } });
    expect(await service.loadFees()).toEqual({ status: "failed", message: LOAD_FAILED_MESSAGE });
  });

  it("maps network, forbidden, other errors and empty", async () => {
    expect(await svc(network).service.loadFees()).toEqual({ status: "failed", message: "offline" });
    expect(await svc(forbidden).service.loadFees()).toEqual({ status: "forbidden" });
    expect(await svc(broken).service.loadFees()).toEqual({ status: "failed", message: "boom" });
    expect(await svc({ status: "empty" }).service.loadFees()).toEqual({
      status: "failed",
      message: LOAD_FAILED_MESSAGE,
    });
  });
});

describe("loadMember", () => {
  const member = {
    id: "m1",
    memberNo: "M-001",
    name: "Sam Lee",
    email: "sam@x.com",
    phone: "555 0100",
    joinedOn: "2026-12-13",
    plan: { name: "Standard" },
    referredBy: { name: "Ana" },
  };

  it("reads the member", async () => {
    const { service, execute } = svc({ status: "data", data: { member } });
    expect(await service.loadMember("m1")).toEqual({
      status: "loaded",
      data: {
        id: "m1",
        memberNo: "M-001",
        name: "Sam Lee",
        email: "sam@x.com",
        phone: "555 0100",
        planName: "Standard",
        joinedOn: "2026-12-13",
        referredByName: "Ana",
      },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("turns missing optional values into null", async () => {
    const bare = { ...member, name: null, phone: null, referredBy: null };
    const result = await svc({ status: "data", data: { member: bare } }).service.loadMember("m1");
    expect(result).toMatchObject({
      status: "loaded",
      data: { name: null, phone: null, referredByName: null },
    });
  });

  it("fails when the member does not exist", async () => {
    const result = await svc({ status: "data", data: { member: null } }).service.loadMember("x");
    expect(result).toEqual({ status: "failed", message: LOAD_FAILED_MESSAGE });
  });

  it("maps a failed request", async () => {
    expect(await svc(forbidden).service.loadMember("m1")).toEqual({ status: "forbidden" });
  });
});

describe("searchReferrers", () => {
  it("asks for a few matches and maps them", async () => {
    const items = [
      { id: "a", name: "Ana", email: "ana@x.com" },
      { id: "b", name: null, email: "b@x.com" },
    ];
    const { service, execute } = svc({ status: "data", data: { members: { items } } });
    expect(await service.searchReferrers("  an ")).toEqual({
      status: "loaded",
      data: [
        { id: "a", name: "Ana", email: "ana@x.com" },
        { id: "b", name: null, email: "b@x.com" },
      ],
    });
    const sent = (
      execute.mock.calls[0] as unknown as [{ variables: unknown; document: string }]
    )[0];
    expect(sent.document).toContain("search");
    expect(REFERRER_LIMIT).toBe(5);
  });

  it("treats an empty answer as no matches and maps failures", async () => {
    expect(await svc({ status: "empty" }).service.searchReferrers("x")).toEqual({
      status: "loaded",
      data: [],
    });
    expect(await svc(network).service.searchReferrers("x")).toEqual({
      status: "failed",
      message: "offline",
    });
  });
});

describe("create", () => {
  const input = {
    name: "Sam Lee",
    email: "sam@x.com",
    phone: null,
    planId: "p1",
    joinedOn: "2026-12-13",
    referredById: null,
  };
  const created = (errors: unknown[], member: unknown = { id: "m9" }) => ({
    status: "data",
    data: { createMember: { member, errors } },
  });

  it("returns the id the server made", async () => {
    const { service, execute } = svc(created([]));
    expect(await service.create(input)).toEqual({ status: "saved", memberId: "m9" });
    const sent = (execute.mock.calls[0] as unknown as [{ variables: Record<string, unknown> }])[0];
    expect(JSON.stringify(sent)).not.toContain("barcode");
  });

  it("sends the phone and referrer only when there are some", async () => {
    const { service, execute } = svc(created([]));
    await service.create({ ...input, phone: "555 0100", referredById: "r1" });
    const sent = JSON.stringify(execute.mock.calls[0]);
    expect(sent).toContain("555 0100");
    expect(sent).toContain("r1");
  });

  it("reports the duplicate email as an invalid field", async () => {
    const problem = {
      code: "CONFLICT",
      field: null,
      message: "This person is already a member here",
    };
    expect(await svc(created([problem], null)).service.create(input)).toEqual({
      status: "invalid",
      problems: [{ field: null, code: "CONFLICT", message: problem.message }],
    });
  });

  it("keeps the field a problem names", async () => {
    const problem = { code: "INVALID_INPUT", field: "input.email", message: "Bad" };
    const result = await svc(created([problem], null)).service.create(input);
    expect(result).toMatchObject({ problems: [{ field: "input.email" }] });
  });

  it("maps forbidden from an error or a user error", async () => {
    expect(await svc(forbidden).service.create(input)).toEqual({ status: "forbidden" });
    const problem = { code: "FORBIDDEN", field: null, message: "no" };
    expect(await svc(created([problem], null)).service.create(input)).toEqual({
      status: "forbidden",
    });
  });

  it("never reads a missing member as saved", async () => {
    expect(await svc(created([], null)).service.create(input)).toEqual({
      status: "failed",
      message: SAVE_FAILED_MESSAGE,
    });
  });

  it("maps network and other errors", async () => {
    expect(await svc(network).service.create(input)).toEqual({
      status: "failed",
      message: "offline",
    });
    expect(await svc(broken).service.create(input)).toEqual({ status: "failed", message: "boom" });
    expect(await svc({ status: "empty" }).service.create(input)).toEqual({
      status: "failed",
      message: SAVE_FAILED_MESSAGE,
    });
  });
});

describe("update", () => {
  it("sends only the name and phone", async () => {
    const { service, execute } = svc({
      status: "data",
      data: { updateMember: { member: { id: "m1" }, errors: [] } },
    });
    expect(await service.update("m1", { name: "Sam", phone: null })).toEqual({
      status: "saved",
      memberId: "m1",
    });
    const sent = JSON.stringify(execute.mock.calls[0]);
    expect(sent).not.toContain("email");
    expect(sent).not.toContain("joinedOn");
  });

  it("maps a failure with no message to the save message", async () => {
    const result = await svc({ status: "error" }).service.update("m1", { name: "S", phone: null });
    expect(result).toEqual({ status: "failed", message: SAVE_FAILED_MESSAGE });
  });

  it("maps a network failure with no message to the save message", async () => {
    const result = await svc({ status: "network" }).service.update("m1", {
      name: "S",
      phone: null,
    });
    expect(result).toEqual({ status: "failed", message: SAVE_FAILED_MESSAGE });
  });
});

describe("failures with no message", () => {
  it("fall back to the load message", async () => {
    expect(await svc({ status: "network" }).service.loadFees()).toEqual({
      status: "failed",
      message: LOAD_FAILED_MESSAGE,
    });
    expect(await svc({ status: "error" }).service.loadFees()).toEqual({
      status: "failed",
      message: LOAD_FAILED_MESSAGE,
    });
  });
});
