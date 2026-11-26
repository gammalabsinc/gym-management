import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUnsavedGuard, UnsavedGuardContext } from "../navigation/unsaved";
import { AddMember, FORBIDDEN_MESSAGE } from "./AddMember";
import { MembersProvider, useMembersService } from "./context";
import { EditMember } from "./EditMember";
import { REFERRER_SEARCH_DELAY_MS, REFERRER_SEARCH_FAILED } from "./ReferrerPicker";
import type {
  GymFees,
  Loaded,
  MemberDetails,
  MembersService,
  Referrer,
  SaveResult,
} from "./service";
import { useSave } from "./useSave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const fees: GymFees = {
  planId: "p1",
  planName: "Standard",
  currency: "USD",
  timezone: "America/Toronto",
  admissionFee: 5000,
  monthlyFee: 8000,
};

const details: MemberDetails = {
  id: "m1",
  memberNo: "M-001",
  name: "Sam Lee",
  email: "sam@x.com",
  phone: "555 0100",
  planName: "Standard",
  joinedOn: "2026-12-13",
  referredByName: null,
};

const loaded = <T>(data: T): Loaded<T> => ({ status: "loaded", data });
const NOW = () => new Date("2026-12-13T15:00:00Z");

function fake(over: Partial<MembersService> = {}) {
  const service: MembersService = {
    loadFees: vi.fn(async () => loaded(fees)),
    loadMember: vi.fn(async () => loaded(details)),
    searchReferrers: vi.fn(async () => loaded<readonly Referrer[]>([])),
    create: vi.fn(async (): Promise<SaveResult> => ({ status: "saved", memberId: "m9" })),
    update: vi.fn(async (): Promise<SaveResult> => ({ status: "saved", memberId: "m1" })),
    ...over,
  };
  return service;
}

function mountAdd(service: MembersService, onDone = vi.fn(), onCancel = vi.fn()) {
  const guard = createUnsavedGuard();
  render(
    createElement(
      UnsavedGuardContext.Provider,
      { value: guard },
      createElement(
        MembersProvider,
        { service },
        createElement(AddMember, { onDone, onCancel, now: NOW }),
      ),
    ),
  );
  return { guard, onDone, onCancel };
}

function mountEdit(service: MembersService, onDone = vi.fn(), onCancel = vi.fn()) {
  const guard = createUnsavedGuard();
  render(
    createElement(
      UnsavedGuardContext.Provider,
      { value: guard },
      createElement(
        MembersProvider,
        { service },
        createElement(EditMember, { memberId: "m1", onDone, onCancel }),
      ),
    ),
  );
  return { guard, onDone, onCancel };
}

const settle = () => act(async () => {});
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (label: string) => fireEvent.click(screen.getByLabelText(label));
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

function fillValid() {
  type("Full name", "Sam Lee");
  type("Google email", "sam@x.com");
}

describe("context", () => {
  it("needs a provider", () => {
    expect(() => renderHook(() => useMembersService())).toThrow(/MembersProvider/);
  });
});

describe("AddMember loading", () => {
  it("shows loading, then the form with today's date and the first invoice", async () => {
    mountAdd(fake());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await settle();
    expect(input("Join date").value).toBe("2026-12-13");
    expect(screen.getByText("First invoice")).toBeTruthy();
    expect(screen.getByText("$50.00")).toBeTruthy();
    expect(screen.getByText("$80.00")).toBeTruthy();
    expect(screen.getByText("$130.00")).toBeTruthy();
    expect(screen.getByText("Due Dec 13, 2026")).toBeTruthy();
  });

  it("uses the real clock when none is given", async () => {
    const service = fake();
    render(
      createElement(
        UnsavedGuardContext.Provider,
        { value: createUnsavedGuard() },
        createElement(
          MembersProvider,
          { service },
          createElement(AddMember, { onDone: vi.fn(), onCancel: vi.fn() }),
        ),
      ),
    );
    await settle();
    expect(input("Join date").value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has no inputs for the barcode or member number", async () => {
    mountAdd(fake());
    await settle();
    expect(screen.queryByLabelText(/barcode/i)).toBeNull();
    expect(screen.queryByLabelText(/member number/i)).toBeNull();
  });

  it("follows the date in the preview and asks for a real one", async () => {
    mountAdd(fake());
    await settle();
    type("Join date", "2026-12");
    expect(screen.getByText("Enter the join date to see the first invoice.")).toBeTruthy();
    type("Join date", "2027-01-05");
    expect(screen.getByText("Due Jan 5, 2027")).toBeTruthy();
  });

  it("shows forbidden without a form", async () => {
    mountAdd(fake({ loadFees: vi.fn(async () => ({ status: "forbidden" as const })) }));
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
    expect(screen.queryByLabelText("Full name")).toBeNull();
  });

  it("shows a failure and retries", async () => {
    const loadFees = vi
      .fn<MembersService["loadFees"]>()
      .mockResolvedValueOnce({ status: "failed", message: "offline" })
      .mockResolvedValueOnce(loaded(fees));
    mountAdd(fake({ loadFees }));
    await settle();
    expect(screen.getByText("offline")).toBeTruthy();
    press("Try again");
    await settle();
    expect(screen.getByLabelText("Full name")).toBeTruthy();
  });
});

describe("AddMember saving", () => {
  it("saves the typed values and hands back the new id", async () => {
    const service = fake();
    const { onDone, guard } = mountAdd(service);
    await settle();
    fillValid();
    expect(guard.isDirty()).toBe(true);
    press("Add member");
    await settle();
    expect(service.create).toHaveBeenCalledWith({
      name: "Sam Lee",
      email: "sam@x.com",
      phone: null,
      planId: "p1",
      joinedOn: "2026-12-13",
      referredById: null,
    });
    expect(onDone).toHaveBeenCalledWith("m9");
    expect(guard.isDirty()).toBe(false);
  });

  it("is clean until something is typed", async () => {
    const { guard } = mountAdd(fake());
    await settle();
    expect(guard.isDirty()).toBe(false);
  });

  it("shows field errors and makes no request", async () => {
    const service = fake();
    mountAdd(service);
    await settle();
    press("Add member");
    await settle();
    expect(screen.getByText("Enter the member's full name.")).toBeTruthy();
    expect(screen.getByText("Enter the member's Google email.")).toBeTruthy();
    expect(service.create).not.toHaveBeenCalled();
    type("Full name", "Sam");
    expect(screen.queryByText("Enter the member's full name.")).toBeNull();
  });

  it("clears an old general message when the next try fails validation", async () => {
    const create = vi.fn(
      async (): Promise<SaveResult> => ({ status: "failed", message: "Server is down" }),
    );
    mountAdd(fake({ create }));
    await settle();
    fillValid();
    press("Add member");
    await settle();
    expect(screen.getByText("Server is down")).toBeTruthy();
    type("Google email", "bad");
    press("Add member");
    await settle();
    expect(screen.queryByText("Server is down")).toBeNull();
  });

  it("shows already a member here on the email field", async () => {
    const create = vi.fn(
      async (): Promise<SaveResult> => ({
        status: "invalid",
        problems: [
          { field: null, code: "CONFLICT", message: "This person is already a member here" },
        ],
      }),
    );
    const { onDone } = mountAdd(fake({ create }));
    await settle();
    fillValid();
    press("Add member");
    await settle();
    expect(screen.getByText("This person is already a member here")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows a problem with no field above Save", async () => {
    const create = vi.fn(
      async (): Promise<SaveResult> => ({
        status: "invalid",
        problems: [{ field: null, code: "NOT_FOUND", message: "Plan not found" }],
      }),
    );
    mountAdd(fake({ create }));
    await settle();
    fillValid();
    press("Add member");
    await settle();
    expect(screen.getByText("Plan not found")).toBeTruthy();
  });

  it("shows forbidden and failure messages", async () => {
    const create = vi
      .fn<MembersService["create"]>()
      .mockResolvedValueOnce({ status: "forbidden" })
      .mockResolvedValueOnce({ status: "failed", message: "Try later" });
    mountAdd(fake({ create }));
    await settle();
    fillValid();
    press("Add member");
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
    press("Add member");
    await settle();
    expect(screen.getByText("Try later")).toBeTruthy();
  });

  it("disables Save while saving, so a double tap adds one member", async () => {
    let release: (result: SaveResult) => void = () => {};
    const create = vi.fn(
      () =>
        new Promise<SaveResult>((resolve) => {
          release = resolve;
        }),
    );
    const { onDone } = mountAdd(fake({ create }));
    await settle();
    fillValid();
    press("Add member");
    press("Saving");
    press("Saving");
    await settle();
    expect((screen.getByLabelText("Saving") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Cancel") as HTMLButtonElement).disabled).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => release({ status: "saved", memberId: "m9" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("cancels", async () => {
    const { onCancel } = mountAdd(fake());
    await settle();
    press("Cancel");
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("referred by", () => {
  const ana: Referrer = { id: "r1", name: "Ana Ruiz", email: "ana@x.com" };
  const noName: Referrer = { id: "r2", name: null, email: "anon@x.com" };

  const search = async (text: string) => {
    type("Referred by (optional)", text);
    await act(async () => {
      vi.advanceTimersByTime(REFERRER_SEARCH_DELAY_MS);
    });
    await settle();
  };

  it("searches after typing pauses, picks a person and sends their id", async () => {
    const searchReferrers = vi.fn(async () => loaded<readonly Referrer[]>([ana, noName]));
    const service = fake({ searchReferrers });
    mountAdd(service);
    await settle();
    type("Referred by (optional)", "an");
    expect(searchReferrers).not.toHaveBeenCalled();
    await search("ana");
    expect(searchReferrers).toHaveBeenCalledWith("ana");
    expect(screen.getByLabelText("Choose anon@x.com")).toBeTruthy();
    press("Choose Ana Ruiz");
    expect(screen.getByText("Ana Ruiz")).toBeTruthy();
    fillValid();
    press("Add member");
    await settle();
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ referredById: "r1" }));
  });

  it("removes the chosen referrer", async () => {
    mountAdd(fake({ searchReferrers: vi.fn(async () => loaded([ana])) }));
    await settle();
    await search("ana");
    press("Choose Ana Ruiz");
    press("Remove referrer");
    expect(screen.getByLabelText("Referred by (optional)")).toBeTruthy();
  });

  it("says when no one matches and when the search fails", async () => {
    const searchReferrers = vi
      .fn<MembersService["searchReferrers"]>()
      .mockResolvedValueOnce(loaded([]))
      .mockResolvedValueOnce({ status: "failed", message: "x" });
    mountAdd(fake({ searchReferrers }));
    await settle();
    await search("zzz");
    expect(screen.getByText("No one matches")).toBeTruthy();
    await search("zz");
    expect(screen.getByText(REFERRER_SEARCH_FAILED)).toBeTruthy();
  });

  it("shows searching, and clearing the text clears the results", async () => {
    mountAdd(fake({ searchReferrers: vi.fn(() => new Promise<never>(() => {})) }));
    await settle();
    type("Referred by (optional)", "an");
    await act(async () => {
      vi.advanceTimersByTime(REFERRER_SEARCH_DELAY_MS);
    });
    expect(screen.getByText("Searching")).toBeTruthy();
    type("Referred by (optional)", "");
    await act(async () => {
      vi.advanceTimersByTime(REFERRER_SEARCH_DELAY_MS);
    });
    expect(screen.queryByText("Searching")).toBeNull();
  });

  it("drops an older answer that arrives after a newer search", async () => {
    const resolvers: Array<(value: Loaded<readonly Referrer[]>) => void> = [];
    const searchReferrers = vi.fn(
      () =>
        new Promise<Loaded<readonly Referrer[]>>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mountAdd(fake({ searchReferrers }));
    await settle();
    await search("an");
    await search("ana");
    await act(async () => resolvers[1]?.(loaded([ana])));
    await act(async () => resolvers[0]?.(loaded([noName])));
    expect(screen.getByLabelText("Choose Ana Ruiz")).toBeTruthy();
    expect(screen.queryByLabelText("Choose anon@x.com")).toBeNull();
  });
});

describe("EditMember", () => {
  it("shows name and phone as inputs and the rest as text", async () => {
    mountEdit(fake());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await settle();
    expect(input("Full name").value).toBe("Sam Lee");
    expect(input("Phone (optional)").value).toBe("555 0100");
    expect(screen.queryByLabelText("Google email")).toBeNull();
    expect(screen.queryByLabelText("Join date")).toBeNull();
    expect(screen.getByText("M-001")).toBeTruthy();
    expect(screen.getByText("sam@x.com")).toBeTruthy();
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("Dec 13, 2026")).toBeTruthy();
    expect(screen.getByText("No one")).toBeTruthy();
    expect(screen.queryByText("First invoice")).toBeNull();
  });

  it("shows the referrer's name and empty values for a member without them", async () => {
    mountEdit(
      fake({
        loadMember: vi.fn(async () =>
          loaded({ ...details, name: null, phone: null, referredByName: "Ana" }),
        ),
      }),
    );
    await settle();
    expect(input("Full name").value).toBe("");
    expect(input("Phone (optional)").value).toBe("");
    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("saves only the name and phone", async () => {
    const service = fake();
    const { onDone, guard } = mountEdit(service);
    await settle();
    expect(guard.isDirty()).toBe(false);
    type("Full name", "Samuel Lee");
    type("Phone (optional)", "");
    expect(guard.isDirty()).toBe(true);
    press("Save changes");
    await settle();
    expect(service.update).toHaveBeenCalledWith("m1", { name: "Samuel Lee", phone: null });
    expect(onDone).toHaveBeenCalled();
    expect(guard.isDirty()).toBe(false);
  });

  it("validates before saving", async () => {
    const service = fake();
    mountEdit(service);
    await settle();
    type("Full name", " ");
    press("Save changes");
    await settle();
    expect(screen.getByText("Enter the member's full name.")).toBeTruthy();
    expect(service.update).not.toHaveBeenCalled();
  });

  it("shows server problems, forbidden and failures", async () => {
    const update = vi
      .fn<MembersService["update"]>()
      .mockResolvedValueOnce({
        status: "invalid",
        problems: [{ field: "patch.phone", code: "INVALID_INPUT", message: "Bad phone" }],
      })
      .mockResolvedValueOnce({ status: "forbidden" })
      .mockResolvedValueOnce({ status: "failed", message: "Try later" });
    mountEdit(fake({ update }));
    await settle();
    press("Save changes");
    await settle();
    expect(screen.getByText("Bad phone")).toBeTruthy();
    press("Save changes");
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
    press("Save changes");
    await settle();
    expect(screen.getByText("Try later")).toBeTruthy();
  });

  it("handles forbidden and failed loads, and cancel", async () => {
    mountEdit(fake({ loadMember: vi.fn(async () => ({ status: "forbidden" as const })) }));
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
    cleanup();

    const loadMember = vi
      .fn<MembersService["loadMember"]>()
      .mockResolvedValueOnce({ status: "failed", message: "offline" })
      .mockResolvedValueOnce(loaded(details));
    const { onCancel } = mountEdit(fake({ loadMember }));
    await settle();
    expect(screen.getByText("offline")).toBeTruthy();
    press("Try again");
    await settle();
    press("Cancel");
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("useSave", () => {
  it("ignores a call while one runs and does not update after unmount", async () => {
    const { result, unmount } = renderHook(() => useSave<string>());
    let release: () => void = () => {};
    const first = act(() =>
      result.current.run(
        () =>
          new Promise<string>((resolve) => {
            release = () => resolve("done");
          }),
      ),
    );
    let second: string | null = "unset";
    await act(async () => {
      second = await result.current.run(async () => "again");
    });
    expect(second).toBeNull();
    unmount();
    expect(result.current.isMounted()).toBe(false);
    release();
    expect(await first).toBe("done");
  });
});
