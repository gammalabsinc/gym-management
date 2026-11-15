import { createHash, randomBytes } from "node:crypto";
import type { SessionTokens } from "../../app/ports";

const TOKEN_BYTES = 32;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * 256 random bits, so the token cannot be guessed and a plain SHA-256 is enough to store: there is
 * nothing to brute force the way there is with a password.
 */
export const sessionTokens: SessionTokens = {
  generate() {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    return { token, tokenHash: sha256Hex(token) };
  },
  hash: sha256Hex,
};
