import type { SessionSource } from "../types/rollout";
import type {
  ApprovalMode,
  CodexProcessOptions,
  SandboxMode,
  StreamGranularity,
} from "../process/types";
import {
  APPROVAL_MODES,
  SANDBOX_MODES,
  STREAM_GRANULARITIES,
} from "../process/types";
import { extractMarkdownTasks } from "../markdown/parser";

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

interface ListArgs {
  source?: SessionSource | undefined;
  cwd?: string | undefined;
  branch?: string | undefined;
  limit: number;
  format: "table" | "json";
}

export function parseListArgs(args: readonly string[]): ListArgs {
  const result: ListArgs = { limit: 50, format: "table" };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--source":
        if (next !== undefined && isSessionSource(next)) {
          result.source = next;
          i++;
        }
        break;
      case "--cwd":
        if (next !== undefined) {
          result.cwd = next;
          i++;
        }
        break;
      case "--branch":
        if (next !== undefined) {
          result.branch = next;
          i++;
        }
        break;
      case "--limit":
        if (next !== undefined) {
          result.limit = parseInt(next, 10) || 50;
          i++;
        }
        break;
      case "--format":
        if (next === "json" || next === "table") {
          result.format = next;
          i++;
        }
        break;
    }
  }

  return result;
}

function isSessionSource(s: string): s is SessionSource {
  return s === "cli" || s === "vscode" || s === "exec" || s === "unknown";
}

export function getArgValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export function getArgValues(
  args: readonly string[],
  flag: string,
): readonly string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      const value = args[i + 1];
      if (value !== undefined) {
        values.push(value);
      }
    }
  }
  return values;
}

export function parseProcessOptions(
  args: readonly string[],
): CodexProcessOptions {
  const opts: {
    model?: string;
    sandbox?: SandboxMode;
    approvalMode?: ApprovalMode;
    fullAuto?: boolean;
    images?: readonly string[];
    streamGranularity?: StreamGranularity;
  } = {};

  const model = getArgValue(args, "--model");
  if (model !== undefined) opts.model = model;

  const sandbox = readAllowedArg(args, "--sandbox", SANDBOX_MODES);
  if (sandbox !== undefined) opts.sandbox = sandbox;
  const approvalMode = readAllowedArg(args, "--approval-mode", APPROVAL_MODES);
  if (approvalMode !== undefined) opts.approvalMode = approvalMode;

  if (args.includes("--full-auto")) {
    opts.fullAuto = true;
  }

  const images = getArgValues(args, "--image");
  if (images.length > 0) {
    opts.images = images;
  }

  const streamGranularity = readAllowedArg(
    args,
    "--stream-granularity",
    STREAM_GRANULARITIES,
  );
  if (streamGranularity !== undefined) {
    opts.streamGranularity = streamGranularity;
  }

  return opts;
}

function readAllowedArg<const T extends readonly string[]>(
  args: readonly string[],
  flag: string,
  allowedValues: T,
): T[number] | undefined {
  const value = getArgValue(args, flag);
  if (value === undefined) {
    return undefined;
  }
  return allowedValues.includes(value) ? value : undefined;
}

export function parseCharDelayMs(args: readonly string[]): number {
  const raw = getArgValue(args, "--char-delay-ms");
  if (raw === undefined) {
    return 8;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 8;
  }
  return parsed;
}

export function isCharChunk(
  chunk: unknown,
): chunk is { readonly kind: "char"; readonly char: string } {
  if (typeof chunk !== "object" || chunk === null) {
    return false;
  }
  const record = chunk as Record<string, unknown>;
  return record["kind"] === "char" && typeof record["char"] === "string";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function renderMarkdownTasks(
  lines: readonly { readonly type: string; readonly payload: unknown }[],
): void {
  const tasks: { sectionHeading: string; text: string; checked: boolean }[] =
    [];

  for (const line of lines) {
    if (line.type === "event_msg") {
      const payload = line.payload as Record<string, unknown>;
      const eventType = payload["type"];
      const message = payload["message"];
      if (
        (eventType === "UserMessage" || eventType === "AgentMessage") &&
        typeof message === "string"
      ) {
        tasks.push(...extractMarkdownTasks(message));
      }
      continue;
    }

    if (line.type === "response_item") {
      const payload = line.payload as Record<string, unknown>;
      if (payload["type"] !== "message") {
        continue;
      }
      const content = payload["content"];
      if (!Array.isArray(content)) {
        continue;
      }
      for (const item of content) {
        if (typeof item !== "object" || item === null) {
          continue;
        }
        const itemObj = item as Record<string, unknown>;
        if (
          (itemObj["type"] === "input_text" ||
            itemObj["type"] === "output_text") &&
          typeof itemObj["text"] === "string"
        ) {
          tasks.push(...extractMarkdownTasks(itemObj["text"]));
        }
      }
    }
  }

  if (tasks.length === 0) {
    console.log("\nMarkdown tasks: none");
    return;
  }

  console.log("\nMarkdown tasks:");
  for (const task of tasks) {
    const checkbox = task.checked ? "[x]" : "[ ]";
    const sectionPrefix =
      task.sectionHeading.length > 0 ? `${task.sectionHeading}: ` : "";
    console.log(`  ${checkbox} ${sectionPrefix}${task.text}`);
  }
}
