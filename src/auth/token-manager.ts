import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type {
  ApiTokenMetadata,
  CreateTokenInput,
  Permission,
  TokenConfig,
  TokenRecord,
  VerifyTokenResult,
} from "./types";

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "codex-agent");
const TOKENS_FILE = "tokens.json";

function resolveConfigDir(configDir?: string): string {
  return configDir ?? DEFAULT_CONFIG_DIR;
}

function tokenFilePath(configDir?: string): string {
  return join(resolveConfigDir(configDir), TOKENS_FILE);
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function parseStoredToken(rawToken: string): { id: string; secret: string } | null {
  const parts = rawToken.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [id, secret] = parts;
  if (id === undefined || secret === undefined || id.length === 0 || secret.length === 0) {
    return null;
  }
  return { id, secret };
}

function toMetadata(record: TokenRecord): ApiTokenMetadata {
  return {
    id: record.id,
    name: record.name,
    permissions: [...record.permissions],
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
}

function isExpired(expiresAt?: string): boolean {
  if (expiresAt === undefined) {
    return false;
  }
  const time = new Date(expiresAt).getTime();
  if (!Number.isFinite(time)) {
    return false;
  }
  return time <= Date.now();
}

export async function loadTokenConfig(configDir?: string): Promise<TokenConfig> {
  const path = tokenFilePath(configDir);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as TokenConfig;
  } catch {
    return { tokens: [] };
  }
}

export async function saveTokenConfig(config: TokenConfig, configDir?: string): Promise<void> {
  const dir = resolveConfigDir(configDir);
  await mkdir(dir, { recursive: true });
  const path = tokenFilePath(configDir);
  const tmpPath = path + ".tmp." + randomUUID().slice(0, 8);
  const json = JSON.stringify(config, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}

export async function createToken(
  input: CreateTokenInput,
  configDir?: string,
): Promise<string> {
  if (input.name.trim().length === 0) {
    throw new Error("name is required");
  }
  if (input.permissions.length === 0) {
    throw new Error("at least one permission is required");
  }

  const id = randomUUID();
  const secret = randomBytes(24).toString("hex");
  const token = `${id}.${secret}`;
  const now = new Date().toISOString();
  const record: TokenRecord = {
    id,
    name: input.name.trim(),
    permissions: [...input.permissions],
    createdAt: now,
    expiresAt: input.expiresAt,
    tokenHash: hashSecret(secret),
  };

  const config = await loadTokenConfig(configDir);
  await saveTokenConfig({ tokens: [...config.tokens, record] }, configDir);
  return token;
}

export async function listTokens(configDir?: string): Promise<readonly ApiTokenMetadata[]> {
  const config = await loadTokenConfig(configDir);
  return config.tokens
    .map(toMetadata)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeToken(id: string, configDir?: string): Promise<boolean> {
  const config = await loadTokenConfig(configDir);
  let found = false;
  const now = new Date().toISOString();
  const updated = config.tokens.map((token) => {
    if (token.id !== id) {
      return token;
    }
    found = true;
    if (token.revokedAt !== undefined) {
      return token;
    }
    return {
      ...token,
      revokedAt: now,
    };
  });
  if (!found) {
    return false;
  }
  await saveTokenConfig({ tokens: updated }, configDir);
  return true;
}

export async function rotateToken(id: string, configDir?: string): Promise<string> {
  const config = await loadTokenConfig(configDir);
  const idx = config.tokens.findIndex((token) => token.id === id);
  if (idx === -1) {
    throw new Error(`token not found: ${id}`);
  }

  const secret = randomBytes(24).toString("hex");
  const replacement = {
    ...config.tokens[idx]!,
    tokenHash: hashSecret(secret),
    revokedAt: undefined,
  };
  const tokens = [...config.tokens];
  tokens[idx] = replacement;
  await saveTokenConfig({ tokens }, configDir);
  return `${id}.${secret}`;
}

export async function verifyToken(
  rawToken: string,
  configDir?: string,
): Promise<VerifyTokenResult> {
  const parsed = parseStoredToken(rawToken);
  if (parsed === null) {
    return { ok: false };
  }

  const config = await loadTokenConfig(configDir);
  const record = config.tokens.find((token) => token.id === parsed.id);
  if (record === undefined) {
    return { ok: false };
  }
  if (record.revokedAt !== undefined || isExpired(record.expiresAt)) {
    return { ok: false };
  }

  const encoder = new TextEncoder();
  const actual = encoder.encode(hashSecret(parsed.secret));
  const expected = encoder.encode(record.tokenHash);
  if (actual.length !== expected.length) {
    return { ok: false };
  }
  if (!timingSafeEqual(actual, expected)) {
    return { ok: false };
  }

  return { ok: true, metadata: toMetadata(record) };
}

export function parsePermissionList(input: string): readonly Permission[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is Permission =>
      value === "session:create" ||
      value === "session:read" ||
      value === "session:cancel" ||
      value === "group:*" ||
      value === "queue:*" ||
      value === "bookmark:*",
    );
}
