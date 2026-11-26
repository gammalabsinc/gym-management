import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { Linking } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "../auth/auth";
import { AuthProvider } from "../auth/context";
import { ProfileProvider, useProfileService } from "./context";
import { mailUrl, telUrl } from "./links";
import { Profile } from "./Profile";
import {
  createProfileService,
  PROFILE_MISSING_MESSAGE,
  type Profile as ProfileData,
  type ProfileResult,
} from "./service";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const profile: ProfileData = {
  name: "Sam Lee",
  email: "sam@gmail.com",
  memberNo: "0042",
  planName: "Monthly",
  joinedOn: "2025-03-09",
  gym: {
    name: "Iron Works",
    phone: "+1 (555) 010-0101",
    email: "hello@ironworks.test",
    address: "1 Main St",
  },
};

function auth(cleared = true) {
  const signOut = vi.fn(async () => ({ revoked: true, cleared }));
  return { signOut, auth: { signOut } as unknown as Auth };
}

function mount(load: () => Promise<ProfileResult>, a = auth()) {
  const service = { load: vi.fn(load) };
  render(
    createElement(
      AuthProvider,
      { auth: a.auth },
      createElement(ProfileProvider, { service }, createElement(Profile)),
    ),
  );
  return { service, signOut: a.signOut };
}

function Probe() {
  useProfileService();
  return null;
}

describe("Profile", () => {
  it("shows the member and the gym block, with no edit control", async () => {
    mount(async () => ({ status: "data", profile }));
    expect(await screen.findByText("Sam Lee")).toBeTruthy();
    expect(screen.getByText("Member since Mar 9, 2025")).toBeTruthy();
    expect(screen.getByText("sam@gmail.com")).toBeTruthy();
    expect(screen.getByText("Monthly")).toBeTruthy();
    expect(screen.getByText("0042")).toBeTruthy();
    expect(screen.getByText("Mar 9, 2025")).toBeTruthy();
    expect(screen.getByText("Iron Works")).toBeTruthy();
    expect(screen.getByText("1 Main St")).toBeTruthy();
    expect(screen.queryByText(/edit/i)).toBeNull();
  });

  it("calls and emails the gym with clean links", async () => {
    const open = vi.spyOn(Linking, "openURL");
    mount(async () => ({ status: "data", profile }));
    fireEvent.click(await screen.findByText("Call"));
    expect(open).toHaveBeenLastCalledWith("tel:+15550100101");
    fireEvent.click(screen.getByText("Email the gym"));
    expect(open).toHaveBeenLastCalledWith("mailto:hello@ironworks.test");
  });

  it("copes when the device cannot open a link", async () => {
    vi.spyOn(Linking, "openURL").mockRejectedValue(new Error("no dialer"));
    mount(async () => ({ status: "data", profile }));
    fireEvent.click(await screen.findByText("Call"));
    expect(screen.getByText("Sam Lee")).toBeTruthy();
  });

  it("hides the rows the gym has not filled in and calls a nameless member Member", async () => {
    mount(async () => ({
      status: "data",
      profile: {
        ...profile,
        name: null,
        gym: { name: "Iron Works", phone: null, email: null, address: null },
      },
    }));
    expect(await screen.findByText("Member")).toBeTruthy();
    expect(screen.queryByText("Call")).toBeNull();
    expect(screen.queryByText("Email the gym")).toBeNull();
    expect(screen.queryByText("Address")).toBeNull();
  });

  it("shows a loading state, then an error that can be retried", async () => {
    const load = vi
      .fn<() => Promise<ProfileResult>>()
      .mockResolvedValueOnce({ status: "failed", message: "Offline" })
      .mockResolvedValueOnce({ status: "data", profile });
    const { service } = mount(load);
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(await screen.findByText("Offline")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Sam Lee")).toBeTruthy();
    expect(service.load).toHaveBeenCalledTimes(2);
  });

  it("signs out, and says so when the device could not be cleared", async () => {
    const ok = mount(async () => ({ status: "data", profile }));
    fireEvent.click(await screen.findByText("Sign out"));
    await waitFor(() => expect(ok.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/could not clear/)).toBeNull();
    cleanup();
    const bad = mount(async () => ({ status: "data", profile }), auth(false));
    fireEvent.click(await screen.findByText("Sign out"));
    expect(await screen.findByText(/could not clear/)).toBeTruthy();
    expect(bad.signOut).toHaveBeenCalledTimes(1);
  });

  it("does not update after it is closed", async () => {
    let finish: (value: ProfileResult) => void = () => undefined;
    mount(() => new Promise<ProfileResult>((resolve) => (finish = resolve)));
    cleanup();
    finish({ status: "data", profile });
    await Promise.resolve();
  });

  it("needs a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(createElement(Probe))).toThrow("ProfileProvider");
  });
});

describe("links", () => {
  it("keeps digits and a leading plus", () => {
    expect(telUrl(" +1 (555) 010-0101 ")).toBe("tel:+15550100101");
    expect(telUrl("555 0101")).toBe("tel:5550101");
    expect(mailUrl("a@b.co")).toBe("mailto:a@b.co");
  });
});

describe("createProfileService", () => {
  const identity = {
    status: "data" as const,
    data: {
      me: { memberId: "m1" },
      tenant: {
        name: "Iron Works",
        branding: { contactPhone: " ", contactEmail: null, contactAddress: " 1 Main St " },
      },
    },
  };
  const member = {
    status: "data" as const,
    data: {
      member: {
        memberNo: "0042",
        name: "Sam Lee",
        email: "sam@gmail.com",
        joinedOn: "2025-03-09",
        plan: { name: "Monthly" },
      },
    },
  };

  // The client is typed by operation, so these tests feed it plain outcomes.
  function svc(...outcomes: unknown[]) {
    const execute = vi.fn();
    for (const outcome of outcomes) execute.mockResolvedValueOnce(outcome);
    const service = createProfileService({ client: { execute } as never });
    return { service, execute };
  }

  it("reads the member and treats blank gym details as missing", async () => {
    const { service, execute } = svc(identity, member);
    expect(await service.load()).toEqual({
      status: "data",
      profile: {
        name: "Sam Lee",
        email: "sam@gmail.com",
        memberNo: "0042",
        planName: "Monthly",
        joinedOn: "2025-03-09",
        gym: { name: "Iron Works", phone: null, email: null, address: "1 Main St" },
      },
    });
    expect(JSON.stringify(execute.mock.calls[1])).toContain('"m1"');
  });

  it("maps every failure of either request", async () => {
    const network = { status: "network", message: "Offline" };
    const error = { status: "error", error: { message: "Nope" } };
    const missing = { status: "empty" };
    const noMember = { status: "data", data: { me: { memberId: null }, tenant: {} } };
    const none = { status: "data", data: { member: null } };
    const cases: [unknown[], string][] = [
      [[network], "Offline"],
      [[error], "Nope"],
      [[missing], PROFILE_MISSING_MESSAGE],
      [[noMember], PROFILE_MISSING_MESSAGE],
      [[identity, network], "Offline"],
      [[identity, error], "Nope"],
      [[identity, missing], PROFILE_MISSING_MESSAGE],
      [[identity, none], PROFILE_MISSING_MESSAGE],
    ];
    for (const [outcomes, message] of cases) {
      expect(await svc(...outcomes).service.load()).toEqual({ status: "failed", message });
    }
  });
});
