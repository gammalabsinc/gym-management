import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeShutdown } from "./shutdown";

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function setup(server: Server, timeoutMs = 5000) {
  const exit = vi.fn();
  const close = vi.fn(async () => {});
  const log = vi.fn();
  return { exit, close, log, shutdown: makeShutdown({ server, close, log, exit, timeoutMs }) };
}

describe("makeShutdown", () => {
  it("lets an in flight request finish before it closes resources and exits 0", async () => {
    let release: () => void = () => {};
    const server = await listen((_req, res) => {
      release = () => res.end("done");
    });
    const { shutdown, exit, close } = setup(server);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const pending = fetch(url).then((r) => r.text());
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await vi.waitFor(() => expect(server.listening).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const drained = shutdown.begin("SIGTERM");
    expect(shutdown.draining()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exit).not.toHaveBeenCalled();
    release();
    expect(await pending).toBe("done");
    await drained;
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("ignores a second signal while draining", async () => {
    const server = await listen((_req, res) => res.end("ok"));
    const { shutdown, exit, close } = setup(server);
    expect(shutdown.draining()).toBe(false);
    await Promise.all([shutdown.begin("SIGTERM"), shutdown.begin("SIGINT")]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("gives up with a failure code when draining takes too long", async () => {
    const server = await listen(() => {});
    const { shutdown, exit, log } = setup(server, 40);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    fetch(url).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    void shutdown.begin("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(log).toHaveBeenCalledWith("drain timed out");
    server.closeAllConnections();
  });
});
