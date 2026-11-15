import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client, Outcome } from "./client";
import { ClientProvider, useMutation, useQuery } from "./hooks";
import { mutation, query } from "./operation";

afterEach(cleanup);

const op = query("Health", { health: true });

function clientWith(outcomes: Outcome<unknown>[]): {
  client: Client;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => outcomes.shift() ?? ({ status: "empty" } as Outcome<unknown>));
  return { client: { execute } as unknown as Client, execute };
}

function Probe(props: { readonly id?: string }) {
  const operation =
    props.id === undefined
      ? op
      : query("M", { member: { args: { id: props.id }, select: { id: true } } });
  const state = useQuery(operation);
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "status" }, state.status),
    createElement("button", { type: "button", onClick: state.refetch }, "again"),
  );
}

const wrap = (client: Client, child: ReturnType<typeof createElement>) =>
  createElement(ClientProvider, { client }, child);

describe("useQuery", () => {
  it("moves from loading to the outcome", async () => {
    const { client } = clientWith([{ status: "data", data: { health: "ok" } }]);
    render(wrap(client, createElement(Probe)));
    expect(screen.getByTestId("status").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("data"));
  });

  it("renders network and error outcomes", async () => {
    const { client } = clientWith([{ status: "network", message: "down" }]);
    render(wrap(client, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("network"));
  });

  it("runs again on refetch", async () => {
    const { client, execute } = clientWith([{ status: "empty" }, { status: "data", data: {} }]);
    render(wrap(client, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("empty"));
    await act(async () => {
      screen.getByText("again").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("data"));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("runs again when the variables change, and ignores a stale answer", async () => {
    let release: (outcome: Outcome<unknown>) => void = () => {};
    const execute = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Outcome<unknown>>((resolve) => (release = resolve)))
      .mockResolvedValueOnce({ status: "data", data: {} });
    const client = { execute } as unknown as Client;
    const view = render(wrap(client, createElement(Probe, { id: "a" })));
    view.rerender(wrap(client, createElement(Probe, { id: "b" })));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("data"));
    await act(async () => release({ status: "empty" }));
    expect(screen.getByTestId("status").textContent).toBe("data");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("needs a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(Probe))).toThrow("useClient needs a ClientProvider");
  });
});

function ScanButton(props: { readonly onResult: (outcome: Outcome<unknown>) => void }) {
  const run = useMutation();
  const scan = mutation("Scan", {
    recordScan: { args: { barcode: "b" }, select: { errors: { message: true } } },
  });
  return createElement(
    "button",
    { type: "button", onClick: () => run(scan).then(props.onResult) },
    "go",
  );
}

describe("useMutation", () => {
  it("sends the mutation through the client", async () => {
    const { client, execute } = clientWith([{ status: "data", data: { ok: true } }]);
    let result: Outcome<unknown> | undefined;
    render(
      wrap(
        client,
        createElement(ScanButton, {
          onResult: (o) => {
            result = o;
          },
        }),
      ),
    );
    await act(async () => screen.getByText("go").click());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "data", data: { ok: true } });
  });
});
