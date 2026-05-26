import { GraphQLError, Kind, type ValueNode } from "graphql";
import type {
  ApprovalMode,
  CodexEnvironmentVariables,
  CodexProcessOptions,
  SandboxMode,
  StreamGranularity,
} from "../process/types";
import {
  APPROVAL_MODES,
  SANDBOX_MODES,
  STREAM_GRANULARITIES,
} from "../process/types";

export interface RecordLike {
  readonly [key: string]: unknown;
}

export function parseJsonLiteral(ast: ValueNode): unknown {
  switch (ast.kind) {
    case Kind.NULL:
      return null;
    case Kind.STRING:
    case Kind.ENUM:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.LIST:
      return ast.values.map((value) => parseJsonLiteral(value));
    case Kind.OBJECT:
      return Object.fromEntries(
        ast.fields.map((field) => [
          field.name.value,
          parseJsonLiteral(field.value),
        ]),
      );
    default:
      return null;
  }
}

export function toRecord(value: unknown, label = "params"): RecordLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GraphQLError(`${label} must be a JSON object`);
  }
  return value as RecordLike;
}

export function readString(
  record: RecordLike,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function readNumber(
  record: RecordLike,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function readBoolean(
  record: RecordLike,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

export function readStringArray(
  record: RecordLike,
  key: string,
): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.some((entry) => typeof entry !== "string")) {
    throw new GraphQLError(`${key} must be a string array`);
  }
  return value as readonly string[];
}

export function readStringUnion<const T extends readonly string[]>(
  record: RecordLike,
  key: string,
  allowedValues: T,
): T[number] | undefined {
  const rawValue = record[key];
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "string") {
    throw new GraphQLError(`${key} must be a string`);
  }
  const value = rawValue;
  if (!isAllowedString(value, allowedValues)) {
    throw new GraphQLError(
      `${key} must be one of: ${allowedValues.join(", ")}`,
    );
  }
  return value;
}

export function requireStringUnion<const T extends readonly string[]>(
  record: RecordLike,
  key: string,
  allowedValues: T,
): T[number] {
  const value = requireString(record, key);
  if (!isAllowedString(value, allowedValues)) {
    throw new GraphQLError(
      `${key} must be one of: ${allowedValues.join(", ")}`,
    );
  }
  return value;
}

function isAllowedString<const T extends readonly string[]>(
  value: string,
  allowedValues: T,
): value is T[number] {
  return allowedValues.includes(value);
}

function readStringRecord(
  record: RecordLike,
  key: string,
): Readonly<Record<string, string>> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GraphQLError(`${key} must be a string-keyed JSON object`);
  }

  const entries = Object.entries(value);
  const invalid = entries.find(
    ([, entryValue]) => typeof entryValue !== "string",
  );
  if (invalid !== undefined) {
    throw new GraphQLError(`${key}.${invalid[0]} must be a string`);
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

export function requireString(record: RecordLike, key: string): string {
  const value = readString(record, key);
  if (value === undefined || value.trim().length === 0) {
    throw new GraphQLError(`${key} is required`);
  }
  return value;
}

export function requireNumber(record: RecordLike, key: string): number {
  const value = readNumber(record, key);
  if (value === undefined) {
    throw new GraphQLError(`${key} is required`);
  }
  return value;
}

export function readProcessOptions(record: RecordLike): CodexProcessOptions {
  const options: {
    model?: string;
    cwd?: string;
    sandbox?: SandboxMode;
    approvalMode?: ApprovalMode;
    fullAuto?: boolean;
    additionalArgs?: readonly string[];
    images?: readonly string[];
    configOverrides?: readonly string[];
    streamGranularity?: StreamGranularity;
    environmentVariables?: CodexEnvironmentVariables;
    codexBinary?: string;
  } = {};
  const model = readString(record, "model");
  if (model !== undefined) options.model = model;
  const cwd = readString(record, "cwd");
  if (cwd !== undefined) options.cwd = cwd;
  const sandbox = readStringUnion(record, "sandbox", SANDBOX_MODES);
  if (sandbox !== undefined) options.sandbox = sandbox;
  const approvalMode = readStringUnion(record, "approvalMode", APPROVAL_MODES);
  if (approvalMode !== undefined) options.approvalMode = approvalMode;
  const fullAuto = readBoolean(record, "fullAuto");
  if (fullAuto !== undefined) options.fullAuto = fullAuto;
  const additionalArgs = readStringArray(record, "additionalArgs");
  if (additionalArgs !== undefined) options.additionalArgs = additionalArgs;
  const images = readStringArray(record, "images");
  if (images !== undefined) options.images = images;
  const configOverrides = readStringArray(record, "configOverrides");
  if (configOverrides !== undefined) options.configOverrides = configOverrides;
  const streamGranularity = readStringUnion(
    record,
    "streamGranularity",
    STREAM_GRANULARITIES,
  );
  if (streamGranularity !== undefined) {
    options.streamGranularity = streamGranularity;
  }
  const environmentVariables = readStringRecord(record, "environmentVariables");
  if (environmentVariables !== undefined) {
    options.environmentVariables = environmentVariables;
  }
  const codexBinary = readString(record, "codexBinary");
  if (codexBinary !== undefined) options.codexBinary = codexBinary;
  return options;
}

export function extractSessionId(
  lines: readonly unknown[],
): string | undefined {
  for (const line of lines) {
    if (typeof line !== "object" || line === null) {
      continue;
    }
    const record = line as RecordLike;
    if (record["type"] !== "session_meta") {
      continue;
    }
    const payload =
      typeof record["payload"] === "object" && record["payload"] !== null
        ? (record["payload"] as RecordLike)
        : null;
    const meta =
      payload !== null &&
      typeof payload["meta"] === "object" &&
      payload["meta"] !== null
        ? (payload["meta"] as RecordLike)
        : null;
    const id = meta === null ? undefined : readString(meta, "id");
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}
