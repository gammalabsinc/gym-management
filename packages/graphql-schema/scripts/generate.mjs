// Writes the generated files from schema.graphql. The stale check lives in src/generated.test.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateFiles } from "../src/generate.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaText = readFileSync(join(root, "schema.graphql"), "utf8");
for (const file of await generateFiles(schemaText)) {
  const target = join(root, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
  console.log(`wrote ${file.path}`);
}
