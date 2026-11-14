import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkFiles,
  extractImports,
  formatViolation,
  isTestFile,
  layerOf,
  stripComments,
} from "./check";

const rules = (file: string, source: string): string[] =>
  checkFile(file, source).map((v) => v.rule);

describe("layerOf", () => {
  it("maps each layer folder", () => {
    expect(layerOf("apps/api/src/domain/a.ts")).toBe("domain");
    expect(layerOf("apps/api/src/main/a.ts")).toBe("main");
  });

  it("returns null outside the layers", () => {
    expect(layerOf("apps/api/src/other/a.ts")).toBeNull();
    expect(layerOf("apps/mobile/src/a.ts")).toBeNull();
  });
});

describe("isTestFile", () => {
  it("recognises test files only", () => {
    expect(isTestFile("a.test.ts")).toBe(true);
    expect(isTestFile("a.ts")).toBe(false);
  });
});

describe("stripComments", () => {
  it("blanks line and block comments and keeps line numbers", () => {
    const out = stripComments("a // x\n/* y\nz */ b\nc");
    expect(out.split("\n")).toHaveLength(4);
    expect(out).not.toContain("x");
    expect(out).not.toContain("z");
    expect(out).toContain("b");
  });

  it("keeps slashes inside urls", () => {
    expect(stripComments('const u = "http://a";')).toContain("http://a");
  });

  it("handles a comment at the very start", () => {
    expect(stripComments("// only").trim()).toBe("");
  });
});

describe("extractImports", () => {
  it("finds static, side effect, dynamic and re-export imports with lines", () => {
    const source = [
      'import a from "one";',
      "import { b,",
      '  c } from "two";',
      'import "three";',
      'const d = await import("four");',
      'export * from "five";',
    ].join("\n");
    expect(extractImports(source)).toEqual([
      { specifier: "one", line: 1 },
      { specifier: "two", line: 2 },
      { specifier: "three", line: 4 },
      { specifier: "four", line: 5 },
      { specifier: "five", line: 6 },
    ]);
  });
});

describe("layer dependency rule", () => {
  it("lets domain import domain", () => {
    expect(rules("apps/api/src/domain/a.ts", 'import { x } from "./b";')).toEqual([]);
  });

  it("stops domain importing typeorm or any package", () => {
    expect(rules("apps/api/src/domain/a.ts", 'import "typeorm";')).toEqual(["layer-dependency"]);
    expect(rules("apps/api/src/domain/a.ts", 'import "node:fs";')).toEqual(["layer-dependency"]);
  });

  it("stops app importing a package", () => {
    expect(rules("apps/api/src/app/a.ts", 'import { z } from "zod";')).toEqual([
      "layer-dependency",
    ]);
  });

  it("stops domain importing app, and app importing infra", () => {
    expect(rules("apps/api/src/domain/a.ts", 'import { x } from "../app/b";')).toEqual([
      "layer-dependency",
    ]);
    expect(rules("apps/api/src/app/a.ts", 'import { x } from "../infra/b";')).toEqual([
      "layer-dependency",
    ]);
  });

  it("lets app import domain, infra import app, api import app, main import everything", () => {
    expect(rules("apps/api/src/app/a.ts", 'import { x } from "../domain/b";')).toEqual([]);
    expect(rules("apps/api/src/infra/a.ts", 'import { x } from "../app/b";')).toEqual([]);
    expect(rules("apps/api/src/api/a.ts", 'import { x } from "../app/b";')).toEqual([]);
    expect(rules("apps/api/src/main/a.ts", 'import { x } from "../infra/b";')).toEqual([]);
  });

  it("stops api importing infra", () => {
    expect(rules("apps/api/src/api/a.ts", 'import { x } from "../infra/b";')).toEqual([
      "layer-dependency",
    ]);
  });

  it("allows a relative import of a file outside the layer folders but inside the service", () => {
    expect(rules("apps/api/src/api/a.ts", 'import { x } from "../shared";')).toEqual([]);
  });

  it("stops any api file reaching out of apps/api/src", () => {
    expect(rules("apps/api/src/infra/a.ts", 'import { x } from "../../../mobile/b";')).toEqual([
      "workspace-boundary",
    ]);
  });
});

describe("database package rule", () => {
  it("stops api importing typeorm and its subpaths", () => {
    expect(rules("apps/api/src/api/a.ts", 'import "typeorm";')).toEqual(["database-package"]);
    expect(rules("apps/api/src/api/a.ts", 'import "pg/lib";')).toEqual(["database-package"]);
  });

  it("allows infra to import typeorm and api to import other packages", () => {
    expect(rules("apps/api/src/infra/a.ts", 'import "typeorm";')).toEqual([]);
    expect(rules("apps/api/src/api/a.ts", 'import { z } from "zod";')).toEqual([]);
    expect(rules("apps/api/src/api/a.ts", 'import "typeorm-extra";')).toEqual([]);
  });
});

describe("ambient state rule", () => {
  it.each([["process.env.X"], ["new Date()"], ["Date.now()"], ["Math.random()"]])(
    "flags %s in domain, app and api",
    (call) => {
      for (const layer of ["domain", "app", "api"]) {
        expect(rules(`apps/api/src/${layer}/a.ts`, `const v = ${call};`)).toEqual([
          "no-ambient-state",
        ]);
      }
    },
  );

  it("allows it in infra and main", () => {
    expect(rules("apps/api/src/infra/a.ts", "const v = process.env.X;")).toEqual([]);
    expect(rules("apps/api/src/main/a.ts", "const v = new Date();")).toEqual([]);
  });

  it("ignores comments and reports the right line", () => {
    expect(rules("apps/api/src/app/a.ts", "// process.env\n/* new Date() */")).toEqual([]);
    const [found] = checkFile("apps/api/src/app/a.ts", "const a = 1;\nconst b = Date.now();");
    expect(found?.line).toBe(2);
  });
});

describe("mobile boundary rule", () => {
  it("stops mobile importing apps/api by path, relative path or package name", () => {
    for (const spec of ["apps/api/src/x", "../../api/src/x", "@gym/api", "@gym/api/x"]) {
      expect(rules("apps/mobile/src/a.ts", `import "${spec}";`)).toEqual(["mobile-api-boundary"]);
    }
  });

  it("lets mobile import the shared schema package and its own files", () => {
    expect(rules("apps/mobile/src/a.ts", 'import "@gym/graphql-schema";')).toEqual([]);
    expect(rules("apps/mobile/src/a.ts", 'import "./b";')).toEqual([]);
  });
});

describe("scope", () => {
  it("skips test files and unrelated files", () => {
    expect(checkFile("apps/api/src/domain/a.test.ts", 'import "typeorm";')).toEqual([]);
    expect(checkFile("packages/x/src/a.ts", 'import "typeorm";')).toEqual([]);
  });

  it("checks many files and formats a violation", () => {
    const found = checkFiles({
      "apps/api/src/domain/a.ts": 'import "typeorm";',
      "apps/api/src/domain/b.ts": "export {};",
    });
    expect(found).toHaveLength(1);
    const [first] = found;
    expect(first && formatViolation(first)).toMatch(
      /^apps\/api\/src\/domain\/a\.ts:1 \[layer-dependency\]/,
    );
  });
});
