import { posix } from "node:path";

export type Layer = "domain" | "app" | "infra" | "api" | "main";

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

const API_ROOT = "apps/api/src/";
const MOBILE_ROOT = "apps/mobile/";

const ALLOWED_LAYERS: Readonly<Record<Layer, readonly Layer[]>> = {
  domain: ["domain"],
  app: ["app", "domain"],
  infra: ["infra", "app", "domain"],
  api: ["api", "app", "domain"],
  main: ["main", "domain", "app", "infra", "api"],
};

const LAYERS = Object.keys(ALLOWED_LAYERS) as Layer[];
const DATABASE_PACKAGES = ["typeorm", "pg", "reflect-metadata"] as const;
const PURE_LAYERS: readonly Layer[] = ["domain", "app", "api"];

const IMPORT_PATTERN =
  /(?:\bimport|\bexport)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const NONDETERMINISTIC_CALLS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\bprocess\.env\b/, label: "process.env" },
  { pattern: /\bnew\s+Date\s*\(/, label: "new Date()" },
  { pattern: /\bDate\.now\s*\(/, label: "Date.now()" },
  { pattern: /\bMath\.random\s*\(/, label: "Math.random()" },
];

export function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts");
}

export function layerOf(file: string): Layer | null {
  if (!file.startsWith(API_ROOT)) return null;
  const first = file.slice(API_ROOT.length).split("/")[0];
  return LAYERS.find((layer) => layer === first) ?? null;
}

/** Blanks out comments but keeps every newline, so line numbers stay correct. */
export function stripComments(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, " ");
  return source.replace(
    /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g,
    (match, lead: string | undefined) =>
      lead === undefined ? blank(match) : lead + blank(match.slice(lead.length)),
  );
}

export interface ImportRef {
  readonly specifier: string;
  readonly line: number;
}

export function extractImports(source: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier === undefined) continue;
    const line = source.slice(0, match.index).split("\n").length;
    refs.push({ specifier, line });
  }
  return refs;
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function matchesPackage(specifier: string, name: string): boolean {
  return specifier === name || specifier.startsWith(`${name}/`);
}

function violation(file: string, line: number, rule: string, message: string): Violation {
  return { file, line, rule, message };
}

function checkApiImport(file: string, layer: Layer, ref: ImportRef): Violation[] {
  const { specifier, line } = ref;
  if (isRelative(specifier)) {
    const target = posix.join(posix.dirname(file), specifier);
    if (!target.startsWith(API_ROOT)) {
      return [violation(file, line, "workspace-boundary", `"${specifier}" leaves apps/api/src`)];
    }
    const targetLayer = layerOf(target);
    if (targetLayer !== null && !ALLOWED_LAYERS[layer].includes(targetLayer)) {
      return [violation(file, line, "layer-dependency", `${layer} may not import ${targetLayer}`)];
    }
    return [];
  }
  if (layer === "domain" || layer === "app") {
    return [
      violation(
        file,
        line,
        "layer-dependency",
        `${layer} may only import its own layers, not "${specifier}"`,
      ),
    ];
  }
  if (PURE_LAYERS.includes(layer)) {
    const banned = DATABASE_PACKAGES.find((name) => matchesPackage(specifier, name));
    if (banned !== undefined) {
      return [violation(file, line, "database-package", `${layer} may not import ${banned}`)];
    }
  }
  return [];
}

function checkMobileImport(file: string, ref: ImportRef): Violation[] {
  const { specifier, line } = ref;
  const target = isRelative(specifier) ? posix.join(posix.dirname(file), specifier) : specifier;
  const reachesApi = target.startsWith("apps/api/") || matchesPackage(target, "@gym/api");
  return reachesApi
    ? [violation(file, line, "mobile-api-boundary", "apps/mobile may not import from apps/api")]
    : [];
}

function checkNondeterminism(file: string, layer: Layer, source: string): Violation[] {
  if (!PURE_LAYERS.includes(layer)) return [];
  const lines = stripComments(source).split("\n");
  return lines.flatMap((text, index) =>
    NONDETERMINISTIC_CALLS.filter(({ pattern }) => pattern.test(text)).map(({ label }) =>
      violation(
        file,
        index + 1,
        "no-ambient-state",
        `${layer} may not use ${label}, inject a port`,
      ),
    ),
  );
}

export function checkFile(file: string, source: string): Violation[] {
  if (isTestFile(file)) return [];
  const code = stripComments(source);
  const layer = layerOf(file);
  if (layer !== null) {
    return [
      ...extractImports(code).flatMap((ref) => checkApiImport(file, layer, ref)),
      ...checkNondeterminism(file, layer, source),
    ];
  }
  if (file.startsWith(MOBILE_ROOT)) {
    return extractImports(code).flatMap((ref) => checkMobileImport(file, ref));
  }
  return [];
}

export function checkFiles(files: Readonly<Record<string, string>>): Violation[] {
  return Object.entries(files).flatMap(([file, source]) => checkFile(file, source));
}

export function formatViolation(v: Violation): string {
  return `${v.file}:${v.line} [${v.rule}] ${v.message}`;
}
