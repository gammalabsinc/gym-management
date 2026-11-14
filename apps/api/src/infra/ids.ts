import { randomUUID } from "node:crypto";
import type { IdGenerator } from "../app/ports";

export const uuidGenerator: IdGenerator = { next: () => randomUUID() };
