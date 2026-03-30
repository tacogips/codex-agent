import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const DIST_ENTRY = join(REPO_ROOT, "dist", "main.js");

const beforeBuild = await readDistFile();
const buildResult = spawnSync("bun", ["run", "build"], {
  cwd: REPO_ROOT,
  encoding: "utf-8",
  stdio: "inherit",
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const afterBuild = await readDistFile();
if (beforeBuild !== afterBuild) {
  console.error("dist/main.js is out of sync with source. Run `bun run build` and commit the updated artifact.");
  process.exit(1);
}

async function readDistFile(): Promise<string | null> {
  try {
    return await readFile(DIST_ENTRY, "utf-8");
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
