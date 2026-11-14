import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { executeGraphqlOperation } from "../graphql/index";

interface GraphqlCliArgs {
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
}

export async function runGraphqlCli(
  args: readonly string[],
  options?: {
    readonly codexHome?: string | undefined;
    readonly configDir?: string | undefined;
  },
): Promise<void> {
  const parsed = await parseGraphqlCliArgs(args);
  const result = await executeGraphqlOperation({
    document: parsed.document,
    variables: parsed.variables,
    context: {
      codexHome: options?.codexHome,
      configDir: options?.configDir,
    },
  });
  if (isAsyncIterable(result)) {
    for await (const event of result) {
      console.log(JSON.stringify(event, null, 2));
      if (Array.isArray(event.errors) && event.errors.length > 0) {
        process.exitCode = 1;
      }
    }
    return;
  }

  console.log(JSON.stringify(result, null, 2));
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    process.exitCode = 1;
  }
}

export async function parseGraphqlCliArgs(
  args: readonly string[],
): Promise<GraphqlCliArgs> {
  const documentArg = args[0];
  if (documentArg === undefined || documentArg.trim().length === 0) {
    throw new Error(
      "Usage: codex-agent gql <query|command> [--param <json|path>] [--variables <json|path>]",
    );
  }

  const variables = await readVariables(args);
  return {
    document: normalizeGraphqlDocument(documentArg),
    ...(variables === undefined ? {} : { variables }),
  };
}

export function normalizeGraphqlDocument(input: string): string {
  const trimmed = input.trim();
  if (
    trimmed.startsWith("query") ||
    trimmed.startsWith("mutation") ||
    trimmed.startsWith("subscription") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("#")
  ) {
    return trimmed;
  }

  const operation = shorthandOperation(trimmed);
  return `${operation} ($param: JSON) { command(name: ${JSON.stringify(trimmed)}, params: $param) }`;
}

async function readVariables(
  args: readonly string[],
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const variablesRaw = getArgValue(args, "--variables");
  const paramRaw = getArgValue(args, "--param") ?? getArgValue(args, "--arg");

  let variables: Readonly<Record<string, unknown>> | undefined;
  if (variablesRaw !== undefined) {
    const parsed = await parseJsonSource(variablesRaw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("--variables must be a JSON object");
    }
    variables = parsed as Readonly<Record<string, unknown>>;
  }

  if (paramRaw === undefined) {
    return variables;
  }

  const param = await parseJsonSource(paramRaw);
  return {
    ...(variables ?? {}),
    param,
  };
}

async function parseJsonSource(raw: string): Promise<unknown> {
  const path = raw.startsWith("@") ? raw.slice(1) : raw;
  const source = (await isReadableFile(path))
    ? await readFile(path, "utf-8")
    : raw;
  try {
    return JSON.parse(source);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON input: ${message}`);
  }
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function getArgValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) {
    return undefined;
  }
  return args[idx + 1];
}

function shorthandOperation(
  command: string,
): "query" | "mutation" | "subscription" {
  if (command === "session.watch") {
    return "subscription";
  }

  if (MUTATION_COMMANDS.has(command)) {
    return "mutation";
  }

  return "query";
}

function isAsyncIterable<T>(
  value: T | AsyncIterable<T>,
): value is AsyncIterable<T> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

const MUTATION_COMMANDS = new Set<string>([
  "session.run",
  "session.resume",
  "session.fork",
  "group.create",
  "group.add",
  "group.remove",
  "group.pause",
  "group.resume",
  "group.delete",
  "group.run",
  "queue.create",
  "queue.add",
  "queue.pause",
  "queue.resume",
  "queue.delete",
  "queue.update",
  "queue.remove",
  "queue.move",
  "queue.mode",
  "queue.run",
  "bookmark.add",
  "bookmark.delete",
  "token.create",
  "token.revoke",
  "token.rotate",
  "files.rebuild",
  "daemon.start",
  "daemon.stop",
  "server.start",
]);
