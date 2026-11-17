import { randomInt } from "node:crypto";
import type { CodeGenerator } from "../../app/ports";
import { CODE_ALPHABET, CODE_LENGTH } from "../../domain/member";

/** Six random characters from a cryptographic source, so a barcode cannot be guessed from the last one. */
export const randomCodes: CodeGenerator = {
  next() {
    return Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join("");
  },
};
