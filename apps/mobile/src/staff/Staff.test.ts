import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffProvider, useStaffService } from "./context";
import { STAFF_FORBIDDEN_MESSAGE, Staff } from "./Staff";
import { LAST_OWNER_NOTE } from "./StaffScreen";
import {
  CHANGE_FAILED_MESSAGE,
  type ChangeResult,
  createStaffService,
  type StaffList,
  type StaffPerson,
  type StaffService,
} from "./service";

afterEach(cleanup);

const sam: StaffPerson = {
  userId: "u1",
  name: "Sam Owner",
  email: "sam@example.com",
  role: "owner",
  hasSignedIn: true,
};
const ali: StaffPerson = {
  userId: "u2",
  name: "Ali Hassan",
  email: "ali@gmail.com",
  role: "staff",
  hasSignedIn: true,
};
const nora: StaffPerson = {
  userId: "u3",
  name: null,
  email: "nora@gmail.com",
  role: "staff",
  hasSignedIn: false,
};

function fake(people: StaffPerson[], over: Partial<StaffService> = {}) {
  let current = people;
  const service: StaffService = {
    list: vi.fn(async (): Promise<StaffList> => ({ status: "loaded", people: current })),
    invite: vi.fn(async (): Promise<ChangeResult> => ({ status: "done" })),
    setRole: vi.fn(async (): Promise<ChangeResult> => ({ status: "done" })),
    removeAccess: vi.fn(async (): Promise<ChangeResult> => ({ status: "done" })),
    ...over,
  };
  return { service, set: (next: StaffPerson[]) => (current = next) };
}

function mount(service: StaffService, viewer: "owner" | "staff" = "owner") {
  return render(createElement(StaffProvider, { service }, createElement(Staff, { viewer })));
}

const settle = () => act(async () => {});

describe("Staff", () => {
  it("lists the people, with an Invited chip until they sign in", async () => {
    mount(fake([sam, ali, nora]).service);
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await settle();
    expect(screen.getByText("Sam Owner")).toBeTruthy();
    expect(screen.getAllByText("nora@gmail.com").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Invited").length).toBe(1);
  });

  it("locks the last owner with the explanation and no remove button", async () => {
    mount(fake([sam, ali]).service);
    await settle();
    expect(screen.getByText(LAST_OWNER_NOTE)).toBeTruthy();
    expect((screen.getByLabelText("Owner Sam Owner") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Staff Sam Owner") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Remove access Sam Owner")).toBeNull();
    expect(screen.getByLabelText("Remove access Ali Hassan")).toBeTruthy();
  });

  it("does not lock an owner when there are two", async () => {
    mount(fake([sam, { ...ali, role: "owner" }]).service);
    await settle();
    expect(screen.queryByText(LAST_OWNER_NOTE)).toBeNull();
    expect((screen.getByLabelText("Staff Sam Owner") as HTMLButtonElement).disabled).toBe(false);
  });

  it("gives staff the forbidden state and makes no request", () => {
    const f = fake([sam]);
    mount(f.service, "staff");
    expect(screen.getByText(STAFF_FORBIDDEN_MESSAGE)).toBeTruthy();
    expect(f.service.list).not.toHaveBeenCalled();
  });

  it("shows forbidden when the server says so", async () => {
    mount(fake([], { list: vi.fn(async () => ({ status: "forbidden" }) as const) }).service);
    await settle();
    expect(screen.getByText(STAFF_FORBIDDEN_MESSAGE)).toBeTruthy();
  });

  it("shows a load failure and retries", async () => {
    const list = vi
      .fn<StaffService["list"]>()
      .mockResolvedValueOnce({ status: "failed", message: "Broken." })
      .mockResolvedValueOnce({ status: "loaded", people: [sam] });
    mount(fake([], { list }).service);
    await settle();
    fireEvent.click(screen.getByLabelText("Try again"));
    await settle();
    expect(screen.getByText("Sam Owner")).toBeTruthy();
  });

  it("shows an empty state", async () => {
    mount(fake([]).service);
    await settle();
    expect(screen.getByText("No staff yet")).toBeTruthy();
  });

  it("confirms before making someone an owner, then reloads", async () => {
    const f = fake([sam, ali]);
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Owner Ali Hassan"));
    expect(screen.getByText("Make Ali Hassan an owner?")).toBeTruthy();
    expect(f.service.setRole).not.toHaveBeenCalled();
    f.set([sam, { ...ali, role: "owner" }]);
    fireEvent.click(screen.getByLabelText("Make owner"));
    await settle();
    expect(f.service.setRole).toHaveBeenCalledWith(ali, "owner");
    expect(f.service.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Make Ali Hassan an owner?")).toBeNull();
  });

  it("confirms a demotion, and tapping the current role does nothing", async () => {
    const f = fake([sam, { ...ali, role: "owner" }]);
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Owner Ali Hassan"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.service.setRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Staff Ali Hassan"));
    expect(screen.getByText("Make Ali Hassan staff?")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Make staff"));
    await settle();
    expect(f.service.setRole).toHaveBeenCalledWith({ ...ali, role: "owner" }, "staff");
  });

  it("cancelling a confirmation changes nothing", async () => {
    const f = fake([sam, ali]);
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Remove access Ali Hassan"));
    expect(screen.getByText("Remove access for Ali Hassan?")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Keep access"));
    expect(f.service.removeAccess).not.toHaveBeenCalled();
    expect(screen.queryByText("Remove access for Ali Hassan?")).toBeNull();
  });

  it("removes access after confirming, naming a person without a name by email", async () => {
    const f = fake([sam, nora]);
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Remove access nora@gmail.com"));
    expect(screen.getByText("Remove access for nora@gmail.com?")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove access"));
    await settle();
    expect(f.service.removeAccess).toHaveBeenCalledWith("u3");
  });

  it("shows the server's refusal when two owners act at once, and reloads the list", async () => {
    const f = fake([sam, { ...ali, role: "owner" }], {
      setRole: vi.fn(
        async () =>
          ({ status: "lastOwner", message: "A gym must keep at least one owner" }) as const,
      ),
    });
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Staff Ali Hassan"));
    fireEvent.click(screen.getByLabelText("Make staff"));
    await settle();
    expect(screen.getByText("A gym must keep at least one owner")).toBeTruthy();
    expect(f.service.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Make Ali Hassan staff?")).toBeNull();
  });

  it("falls to forbidden when a change is refused", async () => {
    const f = fake([sam, ali], {
      removeAccess: vi.fn(async () => ({ status: "forbidden" }) as const),
    });
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Remove access Ali Hassan"));
    fireEvent.click(screen.getByLabelText("Remove access"));
    await settle();
    expect(screen.getByText(STAFF_FORBIDDEN_MESSAGE)).toBeTruthy();
  });

  it("shows a failure on the sheet and lets the person try again", async () => {
    const f = fake([sam, ali], {
      removeAccess: vi.fn(async () => ({ status: "failed", message: "Offline." }) as const),
    });
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Remove access Ali Hassan"));
    fireEvent.click(screen.getByLabelText("Remove access"));
    await settle();
    expect(screen.getByText("Offline.")).toBeTruthy();
    expect(screen.getByText("Remove access for Ali Hassan?")).toBeTruthy();
  });

  it("disables the confirm button while saving", async () => {
    let finish!: (r: ChangeResult) => void;
    const f = fake([sam, ali], {
      removeAccess: vi.fn(
        () =>
          new Promise<ChangeResult>((r) => {
            finish = r;
          }),
      ),
    });
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Remove access Ali Hassan"));
    fireEvent.click(screen.getByLabelText("Remove access"));
    const busy = screen.getByLabelText("Saving") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(f.service.removeAccess).toHaveBeenCalledTimes(1);
    await act(async () => finish({ status: "done" }));
  });

  it("invites by email with an optional name and a role", async () => {
    const f = fake([sam]);
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Invite"));
    fireEvent.change(screen.getByLabelText("Google email"), { target: { value: "new@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "New Person" } });
    fireEvent.click(screen.getByLabelText("Owner"));
    fireEvent.click(screen.getByLabelText("Add to staff"));
    await settle();
    expect(f.service.invite).toHaveBeenCalledWith({
      email: "new@gmail.com",
      name: "New Person",
      role: "owner",
    });
    expect(screen.queryByText("Invite staff")).toBeNull();
  });

  it("defaults the invite role to staff and can switch back", async () => {
    const f = fake([sam]);
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Invite"));
    fireEvent.change(screen.getByLabelText("Google email"), { target: { value: "new@gmail.com" } });
    fireEvent.click(screen.getByLabelText("Owner"));
    fireEvent.click(screen.getByLabelText("Staff"));
    fireEvent.click(screen.getByLabelText("Add to staff"));
    await settle();
    expect(f.service.invite).toHaveBeenCalledWith({
      email: "new@gmail.com",
      name: "",
      role: "staff",
    });
  });

  it("rejects an invalid email on the field before asking the server, and clears it on typing", async () => {
    const f = fake([sam]);
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Invite"));
    fireEvent.change(screen.getByLabelText("Google email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByLabelText("Add to staff"));
    expect(screen.getByText("Enter a Google email, like name@gmail.com.")).toBeTruthy();
    expect(f.service.invite).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Google email"), { target: { value: "nope@x.co" } });
    expect(screen.queryByText("Enter a Google email, like name@gmail.com.")).toBeNull();
  });

  it("puts a server email problem on the email field", async () => {
    const f = fake([sam], {
      invite: vi.fn(
        async () =>
          ({
            status: "invalid",
            problems: [
              { field: "email", code: "INVALID_INPUT", message: "Email already has access." },
            ],
          }) as const,
      ),
    });
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Invite"));
    fireEvent.change(screen.getByLabelText("Google email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByLabelText("Add to staff"));
    await settle();
    expect(screen.getByText("Email already has access.")).toBeTruthy();
  });

  it("shows another invite problem on the sheet", async () => {
    const f = fake([sam], {
      invite: vi.fn(
        async () =>
          ({
            status: "invalid",
            problems: [{ field: null, code: "CONFLICT", message: "Try again." }],
          }) as const,
      ),
    });
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Invite"));
    fireEvent.change(screen.getByLabelText("Google email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByLabelText("Add to staff"));
    await settle();
    expect(screen.getByText("Try again.")).toBeTruthy();
  });

  it("uses a general message for an invalid answer without problems", async () => {
    const f = fake([sam], {
      invite: vi.fn(async () => ({ status: "invalid", problems: [] }) as const),
    });
    mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Invite"));
    fireEvent.change(screen.getByLabelText("Google email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByLabelText("Add to staff"));
    await settle();
    expect(screen.getByText("We could not save that change.")).toBeTruthy();
  });

  it("cancels the invite sheet", async () => {
    mount(fake([sam]).service);
    await settle();
    fireEvent.click(screen.getByLabelText("Invite"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByText("Invite staff")).toBeNull();
  });

  it("ignores answers after unmount", async () => {
    let finish!: (l: StaffList) => void;
    const view = mount(
      fake([], {
        list: vi.fn(
          () =>
            new Promise<StaffList>((r) => {
              finish = r;
            }),
        ),
      }).service,
    );
    view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => finish({ status: "loaded", people: [sam] }));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("ignores a change answer after unmount", async () => {
    let finish!: (r: ChangeResult) => void;
    const f = fake([sam, ali], {
      removeAccess: vi.fn(
        () =>
          new Promise<ChangeResult>((r) => {
            finish = r;
          }),
      ),
    });
    const view = mount(f.service);
    await settle();
    fireEvent.click(screen.getByLabelText("Remove access Ali Hassan"));
    fireEvent.click(screen.getByLabelText("Remove access"));
    view.unmount();
    await act(async () => finish({ status: "done" }));
    expect(f.service.list).toHaveBeenCalledTimes(1);
  });

  it("needs a StaffProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useStaffService())).toThrow("StaffProvider");
  });
});

describe("staff service", () => {
  function svc(...outcomes: unknown[]) {
    const queue = [...outcomes];
    const client = { execute: vi.fn(async () => queue.shift()) };
    // biome-ignore lint/suspicious/noExplicitAny: scripted outcomes
    return { service: createStaffService({ client: client as any }), client };
  }
  const done = (root: string) => ({ status: "data", data: { [root]: { errors: [] } } });

  it("lists people, mapping the owner role and the signed in flag", async () => {
    const { service } = svc({
      status: "data",
      data: {
        staff: [
          { userId: "1", name: "A", email: "a@x.co", roles: ["STAFF", "OWNER"], hasSignedIn: true },
          { userId: "2", name: null, email: "b@x.co", roles: ["STAFF"], hasSignedIn: false },
        ],
      },
    });
    expect(await service.list()).toEqual({
      status: "loaded",
      people: [
        { userId: "1", name: "A", email: "a@x.co", role: "owner", hasSignedIn: true },
        { userId: "2", name: null, email: "b@x.co", role: "staff", hasSignedIn: false },
      ],
    });
  });

  it("maps list failures", async () => {
    expect(await svc({ status: "empty" }).service.list()).toEqual({ status: "loaded", people: [] });
    expect(await svc({ status: "network", message: "offline" }).service.list()).toEqual({
      status: "failed",
      message: "offline",
    });
    expect(
      await svc({ status: "error", error: { code: "FORBIDDEN", message: "x" } }).service.list(),
    ).toEqual({ status: "forbidden" });
    expect(
      await svc({ status: "error", error: { code: "OTHER", message: "boom" } }).service.list(),
    ).toEqual({ status: "failed", message: "boom" });
  });

  it("invites with a trimmed email, leaving a blank name out", async () => {
    const s = svc(done("inviteUser"));
    expect(await s.service.invite({ email: " a@b.co ", name: "  ", role: "staff" })).toEqual({
      status: "done",
    });
    const sent = JSON.stringify(s.client.execute.mock.calls[0]);
    expect(sent).toContain('"a@b.co"');
    expect(sent).toContain('"STAFF"');
    expect(sent).not.toContain("  ");
    const withName = svc(done("inviteUser"));
    await withName.service.invite({ email: "a@b.co", name: "Ann", role: "owner" });
    expect(JSON.stringify(withName.client.execute.mock.calls[0])).toContain('"Ann"');
  });

  it("makes an owner with one call, and a staff member with two, staff first", async () => {
    const up = svc(done("setRole"));
    expect(await up.service.setRole(ali, "owner")).toEqual({ status: "done" });
    expect(up.client.execute).toHaveBeenCalledTimes(1);
    const down = svc(done("setRole"), done("setRole"));
    expect(await down.service.setRole(sam, "staff")).toEqual({ status: "done" });
    expect(down.client.execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(down.client.execute.mock.calls[0])).toContain('"STAFF"');
    expect(JSON.stringify(down.client.execute.mock.calls[1])).toContain('"OWNER"');
  });

  it("stops after a refused first step of a demotion", async () => {
    const s = svc({ status: "network", message: "offline" });
    expect(await s.service.setRole(sam, "staff")).toEqual({ status: "failed", message: "offline" });
    expect(s.client.execute).toHaveBeenCalledTimes(1);
  });

  it("maps the refusals", async () => {
    const lastOwner = {
      status: "data",
      data: { removeAccess: { errors: [{ code: "LAST_OWNER", message: "Keep one" }] } },
    };
    expect(await svc(lastOwner).service.removeAccess("u")).toEqual({
      status: "lastOwner",
      message: "Keep one",
    });
    const forbidden = {
      status: "data",
      data: { removeAccess: { errors: [{ code: "FORBIDDEN", message: "no" }] } },
    };
    expect(await svc(forbidden).service.removeAccess("u")).toEqual({ status: "forbidden" });
    const invalid = {
      status: "data",
      data: { removeAccess: { errors: [{ code: "NOT_FOUND", field: "userId", message: "Gone" }] } },
    };
    expect(await svc(invalid).service.removeAccess("u")).toEqual({
      status: "invalid",
      problems: [{ field: "userId", code: "NOT_FOUND", message: "Gone" }],
    });
    expect(
      await svc({
        status: "error",
        error: { code: "FORBIDDEN", message: "x" },
      }).service.removeAccess("u"),
    ).toEqual({ status: "forbidden" });
    expect(
      await svc({
        status: "error",
        error: { code: "OTHER", message: "boom" },
      }).service.removeAccess("u"),
    ).toEqual({ status: "failed", message: "boom" });
    expect(await svc({ status: "empty" }).service.removeAccess("u")).toEqual({
      status: "failed",
      message: CHANGE_FAILED_MESSAGE,
    });
    expect(await svc(done("removeAccess")).service.removeAccess("u")).toEqual({ status: "done" });
  });
});
