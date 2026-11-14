import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PlaceholderScreen } from "./PlaceholderScreen";

afterEach(cleanup);

describe("PlaceholderScreen", () => {
  it("shows the title and a note that the screen is not built yet", () => {
    render(createElement(PlaceholderScreen, { title: "Sign in" }));
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.getByText("This screen is built in a later ticket.")).toBeTruthy();
  });
});
