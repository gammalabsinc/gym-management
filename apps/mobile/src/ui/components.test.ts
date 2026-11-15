import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Avatar,
  BottomSheet,
  BrandProvider,
  Button,
  Chip,
  DiscountChip,
  EmptyBlock,
  ErrorBlock,
  InvoiceBadge,
  ListRow,
  MIN_TOUCH,
  Skeleton,
  StatusChip,
  TextField,
  TONES,
  useBrand,
} from "./index";

afterEach(cleanup);

const styleOf = (element: HTMLElement) =>
  JSON.parse(element.getAttribute("data-style") ?? "{}") as Record<string, unknown>;

function withBrand(color: string | null, child: ReactElement) {
  return createElement(BrandProvider, { color }, child);
}

describe("chips", () => {
  it("paint status chips from the fixed tones", () => {
    render(createElement(StatusChip, { status: "overdue" }));
    const chip = screen.getByLabelText("Overdue");
    expect(styleOf(chip)).toMatchObject({
      backgroundColor: TONES.bad.background,
      borderColor: TONES.bad.border,
    });
    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("do not change with the gym brand", () => {
    render(withBrand("#7C3AED", createElement(StatusChip, { status: "paid" })));
    expect(styleOf(screen.getByLabelText("Paid"))).toMatchObject({
      backgroundColor: TONES.ok.background,
    });
  });

  it("cover member, invoice and discount states", () => {
    render(
      createElement(
        "div",
        null,
        createElement(StatusChip, { status: "due_soon" }),
        createElement(StatusChip, { status: "paused" }),
        createElement(StatusChip, { status: "cancelled" }),
        createElement(InvoiceBadge, { status: "unpaid" }),
        createElement(InvoiceBadge, { status: "voided" }),
        createElement(DiscountChip, { status: "active" }),
        createElement(DiscountChip, { status: "used" }),
        createElement(Chip, { label: "Custom", tone: "warn" }),
      ),
    );
    for (const label of [
      "Due soon",
      "Paused",
      "Cancelled",
      "Unpaid",
      "Voided",
      "Active",
      "Used",
      "Custom",
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });
});

describe("Avatar", () => {
  it("shows initials at the given size", () => {
    render(createElement(Avatar, { name: "Ayesha Khan", size: 48 }));
    expect(screen.getByText("AK")).toBeTruthy();
    expect(styleOf(screen.getByTestId("avatar"))).toMatchObject({ width: 48, borderRadius: 24 });
  });

  it("defaults to 40 points", () => {
    render(createElement(Avatar, { email: "zed@example.test" }));
    expect(styleOf(screen.getByTestId("avatar"))).toMatchObject({ width: 40 });
  });
});

describe("Button", () => {
  it("paints primary with the brand colour and picks readable text", () => {
    render(withBrand("#FFD400", createElement(Button, { label: "Save", onPress: () => {} })));
    expect(styleOf(screen.getByLabelText("Save"))).toMatchObject({
      backgroundColor: "#FFD400",
      borderColor: "#FFD400",
    });
    expect(styleOf(screen.getByText("Save"))).toMatchObject({ color: "#000000" });
  });

  it("keeps secondary and danger fixed whatever the brand", () => {
    render(
      withBrand(
        "#0B3D2E",
        createElement(
          "div",
          null,
          createElement(Button, { label: "Cancel", kind: "secondary", onPress: () => {} }),
          createElement(Button, { label: "Void", kind: "danger", onPress: () => {} }),
        ),
      ),
    );
    expect(styleOf(screen.getByLabelText("Cancel"))).toMatchObject({ backgroundColor: "#FFFFFF" });
    expect(styleOf(screen.getByLabelText("Void"))).toMatchObject({ borderColor: "#EE9A9A" });
  });

  it("is at least 44 points in both directions", () => {
    render(createElement(Button, { label: "Go", onPress: () => {} }));
    expect(styleOf(screen.getByLabelText("Go"))).toMatchObject({
      minHeight: MIN_TOUCH,
      minWidth: MIN_TOUCH,
    });
  });

  it("calls onPress, unless disabled", () => {
    const onPress = vi.fn();
    render(createElement(Button, { label: "Go", onPress }));
    fireEvent.click(screen.getByLabelText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
    cleanup();
    render(createElement(Button, { label: "Go", onPress, disabled: true }));
    fireEvent.click(screen.getByLabelText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(styleOf(screen.getByLabelText("Go"))).toMatchObject({ opacity: 0.5 });
  });
});

function Show() {
  const brand = useBrand();
  return createElement("span", { "data-testid": "brand" }, `${brand.color} ${brand.onColor}`);
}

describe("BrandProvider", () => {
  it("falls back to the default for a bad colour, and works without a provider", () => {
    render(withBrand("not a colour", createElement(Show)));
    expect(screen.getByTestId("brand").textContent).toBe("#2563EB #FFFFFF");
    cleanup();
    render(createElement(Show));
    expect(screen.getByTestId("brand").textContent).toBe("#2563EB #FFFFFF");
  });
});

describe("TextField", () => {
  it("shows the brand colour on focus and the neutral border otherwise", () => {
    render(
      withBrand(
        "#7C3AED",
        createElement(TextField, { label: "Name", value: "", onChangeText: () => {} }),
      ),
    );
    const input = screen.getByLabelText("Name");
    expect(styleOf(input)).toMatchObject({ borderColor: "#D1D5DB", minHeight: MIN_TOUCH });
    fireEvent.focus(input);
    expect(styleOf(input)).toMatchObject({ borderColor: "#7C3AED" });
    fireEvent.blur(input);
    expect(styleOf(input)).toMatchObject({ borderColor: "#D1D5DB" });
  });

  it("reports typing and shows an error hint in red, not the brand colour", () => {
    const onChangeText = vi.fn();
    render(
      withBrand(
        "#7C3AED",
        createElement(TextField, {
          label: "Email",
          value: "a",
          onChangeText,
          error: "Invalid email",
        }),
      ),
    );
    const input = screen.getByLabelText("Email");
    fireEvent.change(input, { target: { value: "ab" } });
    expect(onChangeText).toHaveBeenCalledWith("ab");
    fireEvent.focus(input);
    expect(styleOf(input)).toMatchObject({ borderColor: "#7F1D1D" });
    expect(screen.getByText("Invalid email")).toBeTruthy();
  });
});

describe("ListRow", () => {
  it("renders title, subtitle and both ends", () => {
    render(
      createElement(ListRow, {
        title: "Ayesha Khan",
        subtitle: "Paid through Dec 13, 2026",
        leading: createElement("i", null, "L"),
        trailing: createElement("i", null, "T"),
      }),
    );
    for (const text of ["Ayesha Khan", "Paid through Dec 13, 2026", "L", "T"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is a button when pressable, and at least 44 points tall", () => {
    const onPress = vi.fn();
    render(createElement(ListRow, { title: "Row", onPress }));
    const row = screen.getByRole("button");
    expect(styleOf(row)).toMatchObject({ minHeight: MIN_TOUCH });
    fireEvent.click(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("BottomSheet", () => {
  it("renders nothing when hidden", () => {
    render(createElement(BottomSheet, { visible: false, title: "Pick", onClose: () => {} }));
    expect(screen.queryByText("Pick")).toBeNull();
  });

  it("shows content and closes from the close control", () => {
    const onClose = vi.fn();
    render(
      createElement(
        BottomSheet,
        { visible: true, title: "Pick", onClose },
        createElement("p", null, "Body"),
      ),
    );
    expect(screen.getByText("Body")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(styleOf(screen.getByLabelText("Close"))).toMatchObject({ minHeight: MIN_TOUCH });
  });
});

describe("blocks", () => {
  it("Skeleton draws three bars by default, or as many as asked", () => {
    render(createElement(Skeleton));
    expect(screen.getAllByTestId("skeleton-line")).toHaveLength(3);
    cleanup();
    render(createElement(Skeleton, { lines: 5 }));
    expect(screen.getAllByTestId("skeleton-line")).toHaveLength(5);
  });

  it("EmptyBlock shows a title and an optional hint", () => {
    render(createElement(EmptyBlock, { title: "No members", hint: "Add one to begin" }));
    expect(screen.getByText("No members")).toBeTruthy();
    expect(screen.getByText("Add one to begin")).toBeTruthy();
    cleanup();
    render(createElement(EmptyBlock, { title: "Nothing" }));
    expect(screen.queryByText("Add one to begin")).toBeNull();
  });

  it("ErrorBlock shows the message and retries on request", () => {
    const onRetry = vi.fn();
    render(createElement(ErrorBlock, { message: "Something went wrong. Reference: r1", onRetry }));
    expect(screen.getByText("Something went wrong. Reference: r1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup();
    render(createElement(ErrorBlock, { message: "No retry" }));
    expect(screen.queryByLabelText("Try again")).toBeNull();
  });
});
