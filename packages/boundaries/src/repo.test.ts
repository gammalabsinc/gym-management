import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { formatViolation } from "./check";
import { checkRepo } from "./repo";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const temporary: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "boundaries-"));
  temporary.push(root);
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checkRepo", () => {
  it("finds no violations in this repository", () => {
    expect(checkRepo(repoRoot).map(formatViolation)).toEqual([]);
  });

  it("reports a domain file that imports typeorm", () => {
    const root = makeRoot({ "apps/api/src/domain/bad.ts": 'import "typeorm";\n' });
    expect(checkRepo(root).map((v) => v.file)).toEqual(["apps/api/src/domain/bad.ts"]);
  });

  it("reports a use case that reads process.env", () => {
    const root = makeRoot({ "apps/api/src/app/bad.ts": "export const x = process.env.A;\n" });
    expect(checkRepo(root).map((v) => v.rule)).toEqual(["no-ambient-state"]);
  });

  it("reports mobile importing apps/api and skips node_modules and non source files", () => {
    const root = makeRoot({
      "apps/mobile/src/bad.ts": 'import "../../api/src/x";\n',
      "apps/mobile/node_modules/dep/index.ts": 'import "apps/api/src/x";\n',
      "apps/mobile/readme.md": "apps/api",
    });
    expect(checkRepo(root).map((v) => v.file)).toEqual(["apps/mobile/src/bad.ts"]);
  });

  it("returns nothing when the scanned folders do not exist", () => {
    expect(checkRepo(makeRoot({}))).toEqual([]);
  });
});
