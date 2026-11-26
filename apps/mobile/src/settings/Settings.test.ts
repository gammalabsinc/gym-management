import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnsavedGuard, UnsavedGuardContext } from "../navigation/unsaved";
import { SettingsProvider, useSettingsService } from "./context";
import { fieldOf, referralPreview, toForm, validate } from "./form";
import { FORBIDDEN_MESSAGE, Settings } from "./Settings";
import {
  createSettingsService,
  type LoadResult,
  NO_SETTINGS_MESSAGE,
  SAVE_FAILED_MESSAGE,
  type SaveResult,
  type SettingsData,
  type SettingsService,
} from "./service";

afterEach(cleanup);

const data: SettingsData = {
  planId: "p1",
  planName: "Standard",
  currency: "USD",
  admissionFee: 5000,
  monthlyFee: 8000,
  warnDaysBefore: 5,
  redDaysAfter: 5,
  dupWindowMin: 10,
  referrerAmount: 1000,
  referrerIsRecurring: true,
  referredAmount: 1500,
  referredIsRecurring: false,
  details: {
    name: "Iron Works Gym",
    color: "#2563EB",
    timezone: "America/Toronto",
    currency: "USD",
  },
};

function fake(over: Partial<SettingsService> = {}) {
  const service: SettingsService = {
    load: vi.fn(async (): Promise<LoadResult> => ({ status: "loaded", data })),
    savePlan: vi.fn(async (): Promise<SaveResult> => ({ status: "saved" })),
    saveSettings: vi.fn(async (): Promise<SaveResult> => ({ status: "saved" })),
    ...over,
  };
  return service;
}

function mount(service: SettingsService, role: "owner" | "staff" = "owner") {
  const guard = createUnsavedGuard();
  const view = render(
    createElement(
      UnsavedGuardContext.Provider,
      { value: guard },
      createElement(SettingsProvider, { service }, createElement(Settings, { viewer: role })),
    ),
  );
  return { guard, view };
}

const settle = () => act(async () => {});
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Settings", () => {
  it("shows the saved values and the read only details", async () => {
    mount(fake());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await settle();
    expect((screen.getByLabelText("Admission") as HTMLInputElement).value).toBe("50.00");
    expect((screen.getByLabelText("Monthly") as HTMLInputElement).value).toBe("80.00");
    expect(screen.getByText("Iron Works Gym")).toBeTruthy();
    expect(screen.getByText("America/Toronto")).toBeTruthy();
    expect(
      screen.getByText(
        /The referrer gets \$10\.00 off every month while the new member stays active/,
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("Save settings") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the default colour label when there is none", async () => {
    mount(
      fake({
        load: vi.fn(
          async () =>
            ({
              status: "loaded",
              data: { ...data, details: { ...data.details, color: null } },
            }) as const,
        ),
      }),
    );
    await settle();
    expect(screen.getByText("Default")).toBeTruthy();
  });

  it("gives staff the forbidden state and makes no request", () => {
    const service = fake();
    mount(service, "staff");
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
    expect(service.load).not.toHaveBeenCalled();
  });

  it("shows forbidden when the server says so", async () => {
    mount(fake({ load: vi.fn(async () => ({ status: "forbidden" }) as const) }));
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
  });

  it("shows a load failure and retries", async () => {
    const load = vi
      .fn<SettingsService["load"]>()
      .mockResolvedValueOnce({ status: "failed", message: "Broken." })
      .mockResolvedValueOnce({ status: "loaded", data });
    mount(fake({ load }));
    await settle();
    expect(screen.getByText("Broken.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Try again"));
    await settle();
    expect(screen.getByLabelText("Admission")).toBeTruthy();
  });

  it("converts typed money to minor units and saves only the changed part", async () => {
    const service = fake();
    mount(service);
    await settle();
    type("Admission", "55.5");
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(service.savePlan).toHaveBeenCalledWith({
      id: "p1",
      name: "Standard",
      admissionFee: 5550,
      monthlyFee: 8000,
    });
    expect(service.saveSettings).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Save settings") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the other settings and the repeat switches", async () => {
    const service = fake();
    mount(service);
    await settle();
    type("Due soon from (days before)", "7");
    fireEvent.click(screen.getByLabelText("New member monthly"));
    fireEvent.click(screen.getByLabelText("Person who refers one time"));
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(service.saveSettings).toHaveBeenCalledWith({
      warnDaysBefore: 7,
      redDaysAfter: 5,
      dupWindowMin: 10,
      referrerAmount: 1000,
      referrerIsRecurring: false,
      referredAmount: 1500,
      referredIsRecurring: true,
    });
    expect(service.savePlan).not.toHaveBeenCalled();
  });

  it("saves both parts, fees first", async () => {
    const calls: string[] = [];
    const service = fake({
      savePlan: vi.fn(async () => {
        calls.push("plan");
        return { status: "saved" } as const;
      }),
      saveSettings: vi.fn(async () => {
        calls.push("settings");
        return { status: "saved" } as const;
      }),
    });
    mount(service);
    await settle();
    type("Monthly", "90");
    type("Overdue after (days late)", "9");
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(calls).toEqual(["plan", "settings"]);
  });

  it("shows invalid input on the field and sends nothing", async () => {
    const service = fake();
    mount(service);
    await settle();
    type("Monthly", "1.234");
    type("Ignore repeat scans within (minutes)", "x");
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(screen.getByText("Use at most 2 decimal places.")).toBeTruthy();
    expect(screen.getByText("Enter a whole number.")).toBeTruthy();
    expect(service.savePlan).not.toHaveBeenCalled();
  });

  it("clears a field's error when it is edited", async () => {
    mount(fake());
    await settle();
    type("Monthly", "abc");
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(screen.getByText("Enter an amount, like 50.00.")).toBeTruthy();
    type("Monthly", "80");
    expect(screen.queryByText("Enter an amount, like 50.00.")).toBeNull();
  });

  it("puts server problems on their field, or a general message", async () => {
    const service = fake({
      savePlan: vi.fn(
        async () =>
          ({
            status: "invalid",
            problems: [
              { field: "input.monthlyFee", message: "Too high." },
              { field: null, message: "Plan is archived." },
            ],
          }) as const,
      ),
    });
    mount(service);
    await settle();
    type("Monthly", "999");
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(screen.getByText("Too high.")).toBeTruthy();
    expect(screen.getByText("Plan is archived.")).toBeTruthy();
  });

  it("keeps the saved fees when only the later call fails", async () => {
    const service = fake({
      saveSettings: vi.fn(async () => ({ status: "failed", message: "Offline." }) as const),
    });
    mount(service);
    await settle();
    type("Monthly", "90");
    type("Overdue after (days late)", "9");
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(screen.getByText("Offline.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(service.savePlan).toHaveBeenCalledTimes(1);
    expect(service.saveSettings).toHaveBeenCalledTimes(2);
  });

  it("falls to the forbidden state when a save is refused", async () => {
    mount(fake({ savePlan: vi.fn(async () => ({ status: "forbidden" }) as const) }));
    await settle();
    type("Monthly", "90");
    fireEvent.click(screen.getByLabelText("Save settings"));
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
  });

  it("disables Save while saving", async () => {
    let finish!: (r: SaveResult) => void;
    const service = fake({
      savePlan: vi.fn(
        () =>
          new Promise<SaveResult>((r) => {
            finish = r;
          }),
      ),
    });
    mount(service);
    await settle();
    type("Monthly", "90");
    fireEvent.click(screen.getByLabelText("Save settings"));
    const busy = screen.getByLabelText("Saving") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(service.savePlan).toHaveBeenCalledTimes(1);
    await act(async () => finish({ status: "saved" }));
  });

  it("tells the unsaved guard about changes and clears it on leaving", async () => {
    const { guard, view } = mount(fake());
    await settle();
    expect(guard.isDirty()).toBe(false);
    type("Monthly", "90");
    expect(guard.isDirty()).toBe(true);
    view.unmount();
    expect(guard.isDirty()).toBe(false);
  });

  it("ignores answers after unmount", async () => {
    let finishLoad!: (r: LoadResult) => void;
    const { view } = mount(
      fake({
        load: vi.fn(
          () =>
            new Promise<LoadResult>((r) => {
              finishLoad = r;
            }),
        ),
      }),
    );
    view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => finishLoad({ status: "loaded", data }));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("ignores a save answer after unmount", async () => {
    let finish!: (r: SaveResult) => void;
    const service = fake({
      savePlan: vi.fn(
        () =>
          new Promise<SaveResult>((r) => {
            finish = r;
          }),
      ),
    });
    const { view } = mount(service);
    await settle();
    type("Monthly", "90");
    fireEvent.click(screen.getByLabelText("Save settings"));
    view.unmount();
    await act(async () => finish({ status: "saved" }));
  });

  it("needs a SettingsProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useSettingsService())).toThrow("SettingsProvider");
  });
});

describe("form helpers", () => {
  const form = toForm(data);

  it("words the preview for one time and monthly discounts", () => {
    expect(referralPreview(form, "USD")).toBe(
      "The referrer gets $10.00 off every month while the new member stays active. The new member gets $15.00 off their first month.",
    );
    expect(
      referralPreview({ ...form, referrerIsRecurring: false, referredIsRecurring: true }, "USD"),
    ).toBe(
      "The referrer gets $10.00 off their next invoice. The new member gets $15.00 off every month.",
    );
    expect(referralPreview({ ...form, referrerAmount: "x" }, "USD")).toBeNull();
    expect(referralPreview({ ...form, referredAmount: "x" }, "USD")).toBeNull();
  });

  it("validates a good form", () => {
    expect(validate(form, "USD")).toMatchObject({
      ok: true,
      fees: { admissionFee: 5000, monthlyFee: 8000 },
    });
  });

  it("maps server field names", () => {
    expect(fieldOf("input.monthlyFee")).toBe("monthlyFee");
    expect(fieldOf("dupWindowMin")).toBe("dupWindowMin");
    expect(fieldOf("input.unknown")).toBeNull();
    expect(fieldOf(null)).toBeNull();
  });
});

describe("settings service", () => {
  function svc(outcome: unknown) {
    const client = { execute: vi.fn(async () => outcome) };
    // biome-ignore lint/suspicious/noExplicitAny: scripted outcome
    return createSettingsService({ client: client as any });
  }
  const tenant = {
    name: "Iron Works Gym",
    timezone: "America/Toronto",
    currency: "USD",
    branding: { primaryColor: "#2563EB" },
    settings: {
      warnDaysBefore: 5,
      redDaysAfter: 5,
      dupWindowMin: 10,
      referrerAmount: 1000,
      referrerIsRecurring: true,
      referredAmount: 1500,
      referredIsRecurring: false,
    },
  };
  const plans = [
    { id: "old", name: "Old", admissionFee: 1, monthlyFee: 1, isActive: false },
    { id: "p1", name: "Standard", admissionFee: 5000, monthlyFee: 8000, isActive: true },
  ];

  it("loads the default plan and the tenant settings", async () => {
    const result = await svc({ status: "data", data: { tenant, plans } }).load();
    expect(result).toEqual({ status: "loaded", data });
  });

  it("keeps a missing brand colour as null", async () => {
    const result = await svc({
      status: "data",
      data: { tenant: { ...tenant, branding: { primaryColor: null } }, plans },
    }).load();
    expect(result.status === "loaded" && result.data.details.color).toBeNull();
  });

  it("fails without an active plan, on empty, network and errors", async () => {
    const none = { status: "failed", message: NO_SETTINGS_MESSAGE };
    expect(await svc({ status: "data", data: { tenant, plans: [] } }).load()).toEqual(none);
    expect(await svc({ status: "empty" }).load()).toEqual(none);
    expect(await svc({ status: "network", message: "offline" }).load()).toEqual({
      status: "failed",
      message: "offline",
    });
    expect(
      await svc({ status: "error", error: { code: "FORBIDDEN", message: "x" } }).load(),
    ).toEqual({ status: "forbidden" });
    expect(
      await svc({ status: "error", error: { code: "INTERNAL", message: "boom" } }).load(),
    ).toEqual({ status: "failed", message: "boom" });
  });

  it("maps save outcomes", async () => {
    const saved = {
      status: "data",
      data: { updatePlan: { errors: [] }, updateSettings: { errors: [] } },
    };
    expect(
      await svc(saved).savePlan({ id: "p", name: "n", admissionFee: 1, monthlyFee: 2 }),
    ).toEqual({ status: "saved" });
    expect(await svc(saved).saveSettings(data as never)).toEqual({ status: "saved" });
    const invalid = {
      status: "data",
      data: {
        updatePlan: {
          errors: [
            { code: "INVALID_INPUT", field: "monthlyFee", message: "Bad" },
            { code: "INVALID_INPUT", message: "General" },
          ],
        },
      },
    };
    expect(
      await svc(invalid).savePlan({ id: "p", name: "n", admissionFee: 1, monthlyFee: 2 }),
    ).toEqual({
      status: "invalid",
      problems: [
        { field: "monthlyFee", message: "Bad" },
        { field: null, message: "General" },
      ],
    });
    const forbidden = {
      status: "data",
      data: { updatePlan: { errors: [{ code: "FORBIDDEN", message: "No" }] } },
    };
    expect(
      await svc(forbidden).savePlan({ id: "p", name: "n", admissionFee: 1, monthlyFee: 2 }),
    ).toEqual({ status: "forbidden" });
    expect(
      await svc({ status: "network", message: "offline" }).savePlan({
        id: "p",
        name: "n",
        admissionFee: 1,
        monthlyFee: 2,
      }),
    ).toEqual({ status: "failed", message: "offline" });
    expect(
      await svc({ status: "error", error: { code: "FORBIDDEN", message: "x" } }).savePlan({
        id: "p",
        name: "n",
        admissionFee: 1,
        monthlyFee: 2,
      }),
    ).toEqual({ status: "forbidden" });
    expect(
      await svc({ status: "error", error: { code: "OTHER", message: "boom" } }).savePlan({
        id: "p",
        name: "n",
        admissionFee: 1,
        monthlyFee: 2,
      }),
    ).toEqual({ status: "failed", message: "boom" });
    expect(
      await svc({ status: "empty" }).savePlan({
        id: "p",
        name: "n",
        admissionFee: 1,
        monthlyFee: 2,
      }),
    ).toEqual({ status: "failed", message: SAVE_FAILED_MESSAGE });
  });
});
