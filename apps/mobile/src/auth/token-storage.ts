/** Where the session token lives on the device. Only ever secure storage, never plain storage. */
export interface TokenStorage {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** The part of expo-secure-store used here. Passed in so tests need no native module. */
export interface SecureStoreLike {
  getItemAsync(key: string, options: SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options: SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options: SecureStoreOptions): Promise<void>;
}

export interface SecureStoreOptions {
  readonly keychainAccessible: number;
}

export const TOKEN_KEY = "gym.session-token";

/**
 * The token is kept in the iOS keychain or the Android keystore, readable after the first unlock
 * and never copied to a new device or a backup. Nothing here logs the token.
 */
export function createSecureTokenStorage(deps: {
  readonly store: SecureStoreLike;
  /** The `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` constant of expo-secure-store. */
  readonly accessible: number;
}): TokenStorage {
  const options: SecureStoreOptions = { keychainAccessible: deps.accessible };
  return {
    read: async () => {
      const value = await deps.store.getItemAsync(TOKEN_KEY, options);
      return value === null || value === "" ? null : value;
    },
    write: (token) => {
      if (token === "") return Promise.reject(new Error("Refusing to store an empty token"));
      return deps.store.setItemAsync(TOKEN_KEY, token, options);
    },
    clear: () => deps.store.deleteItemAsync(TOKEN_KEY, options),
  };
}
