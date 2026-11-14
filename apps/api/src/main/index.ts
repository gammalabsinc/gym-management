import { run } from "./run";

run({
  env: process.env,
  write: (line) => process.stdout.write(`${line}\n`),
  writeError: (message) => process.stderr.write(`${message}\n`),
  exit: (code) => process.exit(code),
});
