import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { checkFiles, type Violation } from "./check";

const SCANNED_ROOTS = ["apps/api/src", "apps/mobile"] as const;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "coverage", "android", "ios"]);
const SOURCE_PATTERN = /\.(ts|tsx|js|jsx)$/;

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (SKIPPED_DIRECTORIES.has(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function checkRepo(root: string): Violation[] {
  const files: Record<string, string> = {};
  for (const scanned of SCANNED_ROOTS) {
    const directory = join(root, scanned);
    if (!isDirectory(directory)) continue;
    for (const path of walk(directory).filter((p) => SOURCE_PATTERN.test(p))) {
      files[relative(root, path).split(sep).join("/")] = readFileSync(path, "utf8");
    }
  }
  return checkFiles(files);
}
