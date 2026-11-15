import type { Server } from "node:http";

export interface ShutdownDeps {
  readonly server: Server;
  /** Closes what the server used, such as the database pool. */
  readonly close: () => Promise<void>;
  readonly log: (message: string) => void;
  readonly exit: (code: number) => void;
  /** Longest time to wait for in flight requests before giving up. */
  readonly timeoutMs: number;
}

export interface Shutdown {
  /** True from the first signal on, so readiness can report not ready while draining. */
  draining(): boolean;
  /** Stops accepting connections, lets in flight requests finish, closes resources, then exits 0. */
  begin(signal: string): Promise<void>;
}

/**
 * Graceful shutdown. The server stops taking new connections and idle keep alive sockets are
 * closed, but a request that is already running is allowed to finish. A timer ends the process
 * with a failure code if draining takes too long.
 */
export function makeShutdown(deps: ShutdownDeps): Shutdown {
  let started = false;
  return {
    draining: () => started,
    async begin(signal) {
      if (started) return;
      started = true;
      deps.log(`${signal} received, draining`);
      const timer = setTimeout(() => {
        deps.log("drain timed out");
        deps.exit(1);
      }, deps.timeoutMs);
      timer.unref();
      await new Promise<void>((resolve) => {
        deps.server.close(() => resolve());
        deps.server.closeIdleConnections();
      });
      await deps.close();
      clearTimeout(timer);
      deps.log("drained");
      deps.exit(0);
    },
  };
}
