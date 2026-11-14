import type { RolloutLine } from "../types/rollout";
import { isEventMsg, isResponseItem } from "../types/rollout";
import type { ChangedFile, FileOperation } from "./types";

const OP_HINTS: readonly { readonly prefix: string; readonly op: FileOperation }[] = [
  { prefix: "rm ", op: "deleted" },
  { prefix: "mv ", op: "modified" },
  { prefix: "cp ", op: "modified" },
  { prefix: "touch ", op: "created" },
  { prefix: "cat >", op: "created" },
  { prefix: "echo >", op: "created" },
  { prefix: "tee ", op: "modified" },
  { prefix: "sed -i", op: "modified" },
  { prefix: "apply_patch", op: "modified" },
  { prefix: "git add ", op: "modified" },
  { prefix: "git rm ", op: "deleted" },
  { prefix: "git mv ", op: "modified" },
];

const FILE_RE = /(^|\/)[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/;

function inferOperation(command: string): FileOperation {
  const normalized = command.trim().toLowerCase();
  for (const hint of OP_HINTS) {
    if (normalized.startsWith(hint.prefix)) {
      return hint.op;
    }
  }
  return "modified";
}

function extractFileTokens(command: string): readonly string[] {
  const tokens = command
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return tokens.filter((token) => {
    if (token.startsWith("-")) return false;
    if (token.includes("*")) return false;
    if (token.startsWith("'") || token.startsWith("\"")) return false;
    return FILE_RE.test(token);
  });
}

function extractCommandsFromLine(line: RolloutLine): readonly string[] {
  if (isEventMsg(line)) {
    if (line.payload.type === "ExecCommandBegin" || line.payload.type === "ExecCommandEnd") {
      const command = line.payload.command;
      if (Array.isArray(command) && command.every((item) => typeof item === "string")) {
        return [command.join(" ")];
      }
      return [];
    }
    return [];
  }

  if (isResponseItem(line) && line.payload.type === "local_shell_call") {
    const action = line.payload.action as Record<string, unknown>;
    const command = action["command"];
    if (Array.isArray(command) && command.every((item) => typeof item === "string")) {
      return [(command as readonly string[]).join(" ")];
    }
  }
  return [];
}

export function extractChangedFiles(lines: readonly RolloutLine[]): readonly ChangedFile[] {
  const map = new Map<string, ChangedFile>();

  for (const line of lines) {
    const commands = extractCommandsFromLine(line);
    for (const command of commands) {
      const operation = inferOperation(command);
      const files = extractFileTokens(command);
      for (const file of files) {
        const prev = map.get(file);
        if (prev === undefined) {
          map.set(file, {
            path: file,
            operation,
            changeCount: 1,
            lastModified: line.timestamp,
          });
        } else {
          map.set(file, {
            ...prev,
            operation: prev.operation === "created" && operation === "deleted" ? "deleted" : operation,
            changeCount: prev.changeCount + 1,
            lastModified: line.timestamp,
          });
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}
