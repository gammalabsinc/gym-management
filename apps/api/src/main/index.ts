import { connectDatabase } from "../infra/db/connection";
import { migrateDatabase } from "../infra/db/migrate";
import { provisionDatabase } from "../infra/db/provision";
import { onboardGym } from "./onboard";
import { run } from "./run";
import { seedDevData } from "./seed";
import { runInvoiceTopUp } from "./worker";

await run({
  env: process.env,
  write: (line) => process.stdout.write(`${line}\n`),
  writeError: (message) => process.stderr.write(`${message}\n`),
  exit: (code) => process.exit(code),
  migrate: migrateDatabase,
  provision: provisionDatabase,
  onboard: onboardGym,
  seed: seedDevData,
  worker: runInvoiceTopUp,
  connect: connectDatabase,
  onSignal: (signal, handler) => {
    process.once(signal, handler);
  },
});
