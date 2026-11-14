import { generate } from "@graphql-codegen/cli";

export interface GeneratedFile {
  /** Path relative to the package root. */
  readonly path: string;
  readonly content: string;
}

export const TYPES_PATH = "src/generated/types.ts";
export const SCHEMA_PATH = "src/generated/schema.ts";

const BANNER =
  "// Generated from schema.graphql. Do not edit. Run `pnpm --filter @gym/graphql-schema generate`.\n";

/** Typed schema text for the server. Kept as a string constant so the API can bundle it. */
export function renderSchemaModule(schemaText: string): string {
  return `${BANNER}export const typeDefs = ${JSON.stringify(schemaText)};\n`;
}

/** Runs codegen in memory. Nothing touches the disk, so a test can compare against what is committed. */
export async function renderTypes(schemaText: string): Promise<string> {
  const files = await generate(
    {
      schema: schemaText,
      generates: {
        [TYPES_PATH]: {
          plugins: ["typescript", "typescript-resolvers"],
          config: {
            enumsAsTypes: true,
            useIndexSignature: true,
            useTypeImports: true,
            scalars: { DateTime: "string", Date: "string", JSON: "unknown" },
          },
        },
      },
    },
    false,
  );
  const file = (files ?? []).find((candidate) => candidate.filename === TYPES_PATH);
  if (file === undefined) throw new Error(`codegen produced no ${TYPES_PATH}`);
  return `${BANNER}${file.content}`;
}

export async function generateFiles(schemaText: string): Promise<GeneratedFile[]> {
  return [
    { path: TYPES_PATH, content: await renderTypes(schemaText) },
    { path: SCHEMA_PATH, content: renderSchemaModule(schemaText) },
  ];
}
