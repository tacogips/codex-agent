import type { RolloutLine } from "../types/rollout";
import { isEventMsg, isResponseItem } from "../types/rollout";
import type {
  ChangedFile,
  FileChangeDetail,
  FileChangeSource,
  FileOperation,
} from "./types";

interface PendingChangeBatch {
  readonly callId?: string;
  readonly changes: readonly FileChangeDetail[];
}

interface PatchSection {
  readonly path: string;
  readonly operation: FileOperation;
  readonly patch: string;
  readonly previousPath?: string;
}

const PATH_TOKEN_RE =
  /^(?:\/|\.{1,2}\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const BASH_LIKE = new Set(["bash", "sh", "zsh"]);
const NON_PATH_TOKENS = new Set([
  "apply_patch",
  "bash",
  "cat",
  "cp",
  "echo",
  "git",
  "mv",
  "perl",
  "printf",
  "rm",
  "sed",
  "sh",
  "tee",
  "touch",
  "zsh",
]);
const REDIRECTION_TOKENS = new Set([">", ">>", "1>", "1>>"]);

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as readonly string[])
    : undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function normalizeCommand(command: readonly string[] | string): string {
  if (typeof command === "string") {
    return command;
  }
  if (
    command.length >= 3 &&
    BASH_LIKE.has(command[0] ?? "") &&
    (command[1] === "-lc" || command[1] === "-c")
  ) {
    return command[2] ?? command.join(" ");
  }
  return command.join(" ");
}

function operationForCommand(command: string): FileOperation | null {
  const normalized = command.trim().toLowerCase();

  if (normalized.includes("apply_patch")) {
    return "modified";
  }
  if (
    normalized.startsWith("touch ") ||
    normalized.startsWith("cat >") ||
    normalized.startsWith("echo >") ||
    normalized.startsWith("printf >")
  ) {
    return "created";
  }
  if (normalized.startsWith("rm ") || normalized.startsWith("git rm ")) {
    return "deleted";
  }
  if (
    normalized.startsWith("mv ") ||
    normalized.startsWith("cp ") ||
    normalized.startsWith("tee ") ||
    normalized.startsWith("git mv ") ||
    /\bsed\s+-i(?:\s|$)/.test(normalized) ||
    /\bperl\b[\s\S]*\s-pi(?:\s|$)/.test(normalized) ||
    /\b(?:cat|echo|printf)\b[\s\S]*>>?\s+\S+/.test(command)
  ) {
    return "modified";
  }
  return null;
}

function extractFileTokens(command: string): readonly string[] {
  const tokens = command
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return tokens.filter((token) => {
    if (!PATH_TOKEN_RE.test(token)) return false;
    if (token.startsWith("-")) return false;
    if (token === "PATCH") return false;
    if (token === "EOF") return false;
    if (NON_PATH_TOKENS.has(token)) return false;
    return true;
  });
}

function commandTokens(command: string): readonly string[] {
  return command
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function tokenizePaths(tokens: readonly string[]): readonly string[] {
  return extractFileTokens(tokens.join(" "));
}

function buildCommandChange(
  path: string,
  timestamp: string,
  source: Exclude<FileChangeSource, "apply_patch">,
  command: string,
  operation: FileOperation,
): FileChangeDetail {
  return {
    path,
    timestamp,
    operation,
    source,
    command,
  };
}

interface RedirectTarget {
  readonly path: string;
  readonly isAppend: boolean;
}

function extractRedirectTarget(
  tokens: readonly string[],
): RedirectTarget | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) {
      continue;
    }

    if (REDIRECTION_TOKENS.has(token)) {
      const target = tokens[i + 1];
      const [path] = target === undefined ? [] : tokenizePaths([target]);
      return path === undefined
        ? undefined
        : {
            path,
            isAppend: token.includes(">>"),
          };
    }

    const redirectMatch = token.match(/^(?:1)?(>>?)(.+)$/);
    if (redirectMatch?.[2] !== undefined) {
      const [path] = tokenizePaths([redirectMatch[2]]);
      return path === undefined
        ? undefined
        : {
            path,
            isAppend: redirectMatch[1] === ">>",
          };
    }
  }

  return undefined;
}

function extractCommandLikeChanges(
  command: string,
  timestamp: string,
  source: Exclude<FileChangeSource, "apply_patch">,
): readonly FileChangeDetail[] {
  const tokens = commandTokens(command);
  const primary = tokens[0];
  if (primary === undefined) {
    return [];
  }

  if (primary === "cat" || primary === "echo" || primary === "printf") {
    const target = extractRedirectTarget(tokens);
    return target === undefined
      ? []
      : [
          buildCommandChange(
            target.path,
            timestamp,
            source,
            command,
            target.isAppend ? "modified" : "created",
          ),
        ];
  }

  if (primary === "touch") {
    return tokenizePaths(tokens.slice(1)).map((path) =>
      buildCommandChange(path, timestamp, source, command, "created"),
    );
  }

  if (primary === "rm") {
    return tokenizePaths(tokens.slice(1)).map((path) =>
      buildCommandChange(path, timestamp, source, command, "deleted"),
    );
  }

  if (primary === "mv") {
    const paths = tokenizePaths(tokens.slice(1));
    if (paths.length < 2) {
      return [];
    }
    const sourcePath = paths[paths.length - 2];
    const targetPath = paths[paths.length - 1];
    if (sourcePath === undefined || targetPath === undefined) {
      return [];
    }
    return [
      buildCommandChange(sourcePath, timestamp, source, command, "deleted"),
      buildCommandChange(targetPath, timestamp, source, command, "modified"),
    ];
  }

  if (primary === "cp") {
    const paths = tokenizePaths(tokens.slice(1));
    const targetPath = paths[paths.length - 1];
    return targetPath === undefined
      ? []
      : [
          buildCommandChange(
            targetPath,
            timestamp,
            source,
            command,
            "modified",
          ),
        ];
  }

  if (primary === "tee") {
    return tokenizePaths(tokens.slice(1)).map((path) =>
      buildCommandChange(path, timestamp, source, command, "modified"),
    );
  }

  if (primary === "git") {
    const subcommand = tokens[1];
    if (subcommand === "rm") {
      return tokenizePaths(tokens.slice(2)).map((path) =>
        buildCommandChange(path, timestamp, source, command, "deleted"),
      );
    }
    if (subcommand === "mv") {
      const paths = tokenizePaths(tokens.slice(2));
      if (paths.length < 2) {
        return [];
      }
      const sourcePath = paths[paths.length - 2];
      const targetPath = paths[paths.length - 1];
      if (sourcePath === undefined || targetPath === undefined) {
        return [];
      }
      return [
        buildCommandChange(sourcePath, timestamp, source, command, "deleted"),
        buildCommandChange(targetPath, timestamp, source, command, "modified"),
      ];
    }
  }

  if (
    /\bsed\s+-i(?:\s|$)/.test(command.toLowerCase()) ||
    /\bperl\b[\s\S]*\s-pi(?:\s|$)/.test(command.toLowerCase())
  ) {
    return tokenizePaths(tokens.slice(1)).map((path) =>
      buildCommandChange(path, timestamp, source, command, "modified"),
    );
  }

  return tokenizePaths(tokens).map((path) =>
    buildCommandChange(
      path,
      timestamp,
      source,
      command,
      operationForCommand(command) ?? "modified",
    ),
  );
}

function extractPatchBlocks(command: string): readonly string[] {
  const matches = command.match(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/gm);
  return matches ?? [];
}

function parsePatchSections(patchText: string): readonly PatchSection[] {
  const lines = patchText.replaceAll("\r\n", "\n").split("\n");
  const sections: PatchSection[] = [];

  let currentOperation: FileOperation | null = null;
  let currentPath: string | null = null;
  let currentPreviousPath: string | undefined;
  let currentLines: string[] = [];

  function flush(): void {
    if (
      currentOperation === null ||
      currentPath === null ||
      currentLines.length === 0
    ) {
      return;
    }
    sections.push({
      path: currentPath,
      operation: currentOperation,
      patch: currentLines.join("\n").trimEnd(),
      ...(currentPreviousPath !== undefined
        ? { previousPath: currentPreviousPath }
        : {}),
    });
  }

  for (const line of lines) {
    if (line.startsWith("*** Update File: ")) {
      flush();
      currentOperation = "modified";
      currentPath = line.slice("*** Update File: ".length).trim();
      currentPreviousPath = undefined;
      currentLines = [line];
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      flush();
      currentOperation = "created";
      currentPath = line.slice("*** Add File: ".length).trim();
      currentPreviousPath = undefined;
      currentLines = [line];
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      flush();
      currentOperation = "deleted";
      currentPath = line.slice("*** Delete File: ".length).trim();
      currentPreviousPath = undefined;
      currentLines = [line];
      continue;
    }
    if (currentPath === null) {
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      currentPreviousPath = currentPath;
      currentPath = line.slice("*** Move to: ".length).trim();
    }
    currentLines.push(line);
  }

  flush();
  return sections.filter((section) => section.path.length > 0);
}

function changesFromPatchBlocks(
  patchBlocks: readonly string[],
  timestamp: string,
  command?: string,
): readonly FileChangeDetail[] {
  const changes: FileChangeDetail[] = [];
  for (const block of patchBlocks) {
    for (const section of parsePatchSections(block)) {
      changes.push({
        path: section.path,
        timestamp,
        operation: section.operation,
        source: "apply_patch",
        ...(command !== undefined ? { command } : {}),
        patch: section.patch,
        ...(section.previousPath !== undefined
          ? { previousPath: section.previousPath }
          : {}),
      });
    }
  }
  return changes;
}

function extractChangesFromCommand(
  command: string,
  timestamp: string,
  source: Exclude<FileChangeSource, "apply_patch">,
): readonly FileChangeDetail[] {
  const patchBlocks = extractPatchBlocks(command);
  if (patchBlocks.length > 0) {
    return changesFromPatchBlocks(patchBlocks, timestamp, command);
  }

  const operation = operationForCommand(command);
  if (operation === null) {
    return [];
  }
  return extractCommandLikeChanges(command, timestamp, source);
}

function extractToolCallChanges(line: RolloutLine): PendingChangeBatch | null {
  if (!isResponseItem(line)) {
    return null;
  }

  const payload = toRecord(line.payload);
  if (payload === null) {
    return null;
  }

  const itemType = readString(payload["type"]);
  if (itemType === "function_call") {
    const callId = readString(payload["call_id"]);
    const name = readString(payload["name"]);
    const rawArgs = parseMaybeJson(readString(payload["arguments"]));
    const args = toRecord(rawArgs);
    if (name === "shell") {
      const command =
        args === null ? undefined : readStringArray(args["command"]);
      if (command === undefined) {
        return null;
      }
      return {
        ...(callId !== undefined ? { callId } : {}),
        changes: extractChangesFromCommand(
          normalizeCommand(command),
          line.timestamp,
          "shell",
        ),
      };
    }
    if (name === "exec_command") {
      const command = args === null ? undefined : readString(args["cmd"]);
      if (command === undefined) {
        return null;
      }
      return {
        ...(callId !== undefined ? { callId } : {}),
        changes: extractChangesFromCommand(
          command,
          line.timestamp,
          "exec_command",
        ),
      };
    }
    if (name === "apply_patch") {
      const patchText =
        args !== null
          ? (readString(args["patch"]) ?? readString(args["input"]))
          : readString(payload["arguments"]);
      if (patchText === undefined) {
        return null;
      }
      return {
        ...(callId !== undefined ? { callId } : {}),
        changes: changesFromPatchBlocks([patchText], line.timestamp),
      };
    }
    return null;
  }

  if (itemType === "local_shell_call") {
    const action = toRecord(payload["action"]);
    const command =
      action === null ? undefined : readStringArray(action["command"]);
    if (command === undefined) {
      return null;
    }
    const callId = readString(payload["call_id"]);
    return {
      ...(callId !== undefined ? { callId } : {}),
      changes: extractChangesFromCommand(
        normalizeCommand(command),
        line.timestamp,
        "local_shell",
      ),
    };
  }

  if (itemType === "custom_tool_call") {
    const name = readString(payload["name"]);
    const status = readString(payload["status"]);
    if (
      name !== "apply_patch" ||
      (status !== undefined && status !== "completed")
    ) {
      return null;
    }
    const input = readString(payload["input"]);
    if (input === undefined) {
      return null;
    }
    return {
      changes: changesFromPatchBlocks([input], line.timestamp),
    };
  }

  return null;
}

function extractExecBeginChanges(line: RolloutLine): PendingChangeBatch | null {
  if (!isEventMsg(line)) {
    return null;
  }
  if (line.payload.type !== "ExecCommandBegin") {
    return null;
  }
  const payload = toRecord(line.payload);
  const command =
    payload === null ? undefined : readStringArray(payload["command"]);
  const callId = payload === null ? undefined : readString(payload["call_id"]);
  if (command === undefined) {
    return null;
  }
  return {
    changes: extractChangesFromCommand(
      normalizeCommand(command),
      line.timestamp,
      "local_shell",
    ),
    ...(callId !== undefined ? { callId } : {}),
  };
}

function isSuccessfulToolResult(
  line: RolloutLine,
): { readonly callId: string; readonly success: boolean } | null {
  if (isEventMsg(line) && line.payload.type === "ExecCommandEnd") {
    const payload = toRecord(line.payload);
    const callId =
      payload === null ? undefined : readString(payload["call_id"]);
    const exitCode =
      payload === null ? undefined : readNumber(payload["exit_code"]);
    if (callId === undefined) {
      return null;
    }
    return {
      callId,
      success: exitCode === 0,
    };
  }

  if (!isResponseItem(line)) {
    return null;
  }

  const payload = toRecord(line.payload);
  if (payload === null) {
    return null;
  }

  const itemType = readString(payload["type"]);
  if (itemType === "function_call_output") {
    const callId = readString(payload["call_id"]);
    if (callId === undefined) {
      return null;
    }
    const output = parseMaybeJson(payload["output"]);
    const outputRecord = toRecord(output);
    const metadata =
      outputRecord === null ? null : toRecord(outputRecord["metadata"]);
    const exitCode =
      (metadata === null ? undefined : readNumber(metadata["exit_code"])) ??
      (outputRecord === null
        ? undefined
        : readNumber(outputRecord["exit_code"]));
    const status =
      outputRecord === null ? undefined : readString(outputRecord["status"]);
    const isError =
      outputRecord === null ? false : outputRecord["is_error"] === true;

    return {
      callId,
      success:
        !isError &&
        (status === undefined || (status !== "error" && status !== "failed")) &&
        (exitCode === undefined || exitCode === 0),
    };
  }

  if (itemType === "local_shell_call") {
    const callId = readString(payload["call_id"]);
    const status = readString(payload["status"]);
    if (callId === undefined || status === undefined) {
      return null;
    }
    if (status === "completed") {
      return { callId, success: true };
    }
    if (status === "failed" || status === "error") {
      return { callId, success: false };
    }
  }

  return null;
}

export function extractFileChangeDetails(
  lines: readonly RolloutLine[],
): readonly FileChangeDetail[] {
  const changes: FileChangeDetail[] = [];
  const pending = new Map<string, PendingChangeBatch>();

  for (const line of lines) {
    const immediate = extractToolCallChanges(line);
    if (immediate !== null) {
      const callId = immediate.callId;
      if (callId === undefined) {
        changes.push(...immediate.changes);
      } else if (immediate.changes.length > 0) {
        pending.set(callId, immediate);
      }
    }

    const execBegin = extractExecBeginChanges(line);
    if (
      execBegin !== null &&
      execBegin.callId !== undefined &&
      execBegin.changes.length > 0
    ) {
      pending.set(execBegin.callId, execBegin);
    }

    const result = isSuccessfulToolResult(line);
    if (result === null) {
      continue;
    }

    const matched = pending.get(result.callId);
    if (matched === undefined) {
      continue;
    }
    pending.delete(result.callId);
    if (result.success) {
      changes.push(...matched.changes);
    }
  }

  return changes.sort((a, b) => {
    const timeCompare = a.timestamp.localeCompare(b.timestamp);
    if (timeCompare !== 0) {
      return timeCompare;
    }
    return a.path.localeCompare(b.path);
  });
}

export function extractChangedFiles(
  lines: readonly RolloutLine[],
): readonly ChangedFile[] {
  const map = new Map<string, ChangedFile>();

  for (const change of extractFileChangeDetails(lines)) {
    if (
      change.previousPath !== undefined &&
      change.previousPath !== change.path
    ) {
      const previousPath = map.get(change.previousPath);
      map.set(change.previousPath, {
        path: change.previousPath,
        operation: "deleted",
        changeCount: (previousPath?.changeCount ?? 0) + 1,
        lastModified: change.timestamp,
      });
    }

    const previous = map.get(change.path);
    if (previous === undefined) {
      map.set(change.path, {
        path: change.path,
        operation: change.operation,
        changeCount: 1,
        lastModified: change.timestamp,
      });
      continue;
    }

    map.set(change.path, {
      path: previous.path,
      operation: change.operation,
      changeCount: previous.changeCount + 1,
      lastModified: change.timestamp,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}
