import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigProvider, useConfig } from "./context";

function ShowUrl() {
  return createElement("span", { "data-testid": "url" }, useConfig().apiUrl);
}

afterEach(cleanup);

describe("ConfigProvider", () => {
  it("gives children the config", () => {
    const config = { appEnv: "development", apiUrl: "http://localhost:3000" } as const;
    render(createElement(ConfigProvider, { config }, createElement(ShowUrl)));
    expect(screen.getByTestId("url").textContent).toBe("http://localhost:3000");
  });

  it("fails loudly when used outside the provider", () => {
    expect(() => render(createElement(ShowUrl))).toThrow(
      "useConfig must be used inside ConfigProvider",
    );
  });
});
