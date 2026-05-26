import { getToolVersions } from "../sdk/tool-versions";
import { checkCodexModelAvailability } from "../sdk/model-availability";
import { getArgValue } from "./parsing";
import { USAGE } from "./usage";

export async function handleVersion(args: readonly string[]): Promise<void> {
  const { asJson, includeGit } = parseVersionArgs(args);
  const versions = await getToolVersions({ includeGit });

  if (asJson) {
    console.log(JSON.stringify(versions, null, 2));
    return;
  }

  printToolVersion("codex", versions.codex);
  if (versions.git !== undefined) {
    printToolVersion("git", versions.git);
  }
}

export function parseVersionArgs(args: readonly string[]): {
  readonly asJson: boolean;
  readonly includeGit: boolean;
} {
  return {
    asJson: args.includes("--json"),
    includeGit: args.includes("--include-git"),
  };
}

function printToolVersion(
  name: string,
  info: { readonly version: string | null; readonly error: string | null },
): void {
  if (info.error === null) {
    console.log(`${name}: ${info.version}`);
    return;
  }
  console.log(`${name}: unavailable (${info.error})`);
}

// ---------------------------------------------------------------------------
// Model commands
// ---------------------------------------------------------------------------

export interface ModelCheckArgs {
  readonly model?: string;
  readonly asJson: boolean;
  readonly timeoutMs?: number;
}

export async function handleModel(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
  if (action !== "check") {
    console.error(`Unknown model action: ${action ?? "(none)"}`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const parsed = parseModelCheckArgs(args);
  if (parsed.model === undefined || parsed.model.trim().length === 0) {
    console.error(
      "Usage: codex-agent model check --model <model> [--json] [--timeout-ms <ms>]",
    );
    process.exitCode = 1;
    return;
  }

  const result = await checkCodexModelAvailability({
    model: parsed.model,
    ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
  });

  if (parsed.asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Overall: ${result.ok ? "available" : "unavailable"}`);
    console.log(
      `Auth:    ${result.auth.ok ? "available" : "unavailable"}${result.auth.status !== null ? ` (${result.auth.status})` : ""}`,
    );
    console.log(`Model:   ${result.model}`);
    console.log(
      `Probe:   ${result.probe.ok ? "available" : "unavailable"}${result.probe.error !== null ? ` (${result.probe.error})` : ""}`,
    );
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

export function parseModelCheckArgs(args: readonly string[]): ModelCheckArgs {
  const timeoutRaw = getArgValue(args, "--timeout-ms");
  const timeoutMs =
    timeoutRaw !== undefined ? Number.parseInt(timeoutRaw, 10) : undefined;
  const parsed: {
    model?: string;
    asJson: boolean;
    timeoutMs?: number;
  } = {
    asJson: args.includes("--json"),
  };

  const model = getArgValue(args, "--model");
  if (model !== undefined) {
    parsed.model = model;
  }
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    parsed.timeoutMs = timeoutMs;
  }

  return parsed;
}
