import { describe, expect, it, vi } from "vitest";
import { createSecureTokenStorage, TOKEN_KEY } from "./token-storage";

function fake(initial: string | null = null) {
  let value = initial;
  return {
    getItemAsync: vi.fn(async () => value),
    setItemAsync: vi.fn(async (_key: string, next: string) => {
      value = next;
    }),
    deleteItemAsync: vi.fn(async () => {
      value = null;
    }),
  };
}

describe("secure token storage", () => {
  it("writes, reads and clears with the device only accessibility", async () => {
    const store = fake();
    const storage = createSecureTokenStorage({ store, accessible: 7 });
    await storage.write("abc");
    expect(store.setItemAsync).toHaveBeenCalledWith(TOKEN_KEY, "abc", { keychainAccessible: 7 });
    expect(await storage.read()).toBe("abc");
    await storage.clear();
    expect(store.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, { keychainAccessible: 7 });
    expect(await storage.read()).toBeNull();
  });

  it("treats an empty stored value as no token", async () => {
    const storage = createSecureTokenStorage({ store: fake(""), accessible: 1 });
    expect(await storage.read()).toBeNull();
  });

  it("refuses to store an empty token", async () => {
    const store = fake();
    const storage = createSecureTokenStorage({ store, accessible: 1 });
    await expect(storage.write("")).rejects.toThrow("empty token");
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });
});
