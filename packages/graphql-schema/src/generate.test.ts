import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generateFiles,
  renderSchemaModule,
  renderTypes,
  SCHEMA_PATH,
  TYPES_PATH,
} from "./generate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaText = readFileSync(join(root, "schema.graphql"), "utf8");

describe("generated files", () => {
  it("are up to date with schema.graphql", async () => {
    const stale: string[] = [];
    for (const file of await generateFiles(schemaText)) {
      if (readFileSync(join(root, file.path), "utf8") !== file.content) stale.push(file.path);
    }
    expect(stale, "run `pnpm --filter @gym/graphql-schema generate` and commit the result").toEqual(
      [],
    );
  });
});

describe("renderTypes", () => {
  it("emits resolver types for the schema", async () => {
    const types = await renderTypes("type Query { health: String! }");
    expect(types).toContain("export type QueryResolvers");
    expect(types).toContain("import type");
  });

  it("rejects an invalid schema instead of writing a partial file", async () => {
    await expect(renderTypes("type Query { health: Missing! }")).rejects.toThrow();
  });
});

describe("renderSchemaModule", () => {
  it("embeds the schema text as a string constant", () => {
    const rendered = renderSchemaModule("type Query { a: String }\n");
    expect(rendered).toContain('export const typeDefs = "type Query { a: String }\\n";');
  });
});

describe("generateFiles", () => {
  it("returns the types and the schema module", async () => {
    const files = await generateFiles("type Query { health: String! }");
    expect(files.map((file) => file.path)).toEqual([TYPES_PATH, SCHEMA_PATH]);
  });
});
