import {
  createToken,
  DEFAULT_TOKEN_PERMISSIONS,
  listTokens,
  parsePermissionList,
  PERMISSIONS,
  revokeToken,
  rotateToken,
} from "../../auth/index";
import { getArgValue } from "../parsing";
import { USAGE } from "../usage";

// ---------------------------------------------------------------------------
// Token commands
// ---------------------------------------------------------------------------

export async function handleToken(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
  switch (action) {
    case "create":
      await handleTokenCreate(args);
      break;
    case "list":
      await handleTokenList(args);
      break;
    case "revoke":
      await handleTokenRevoke(args);
      break;
    case "rotate":
      await handleTokenRotate(args);
      break;
    default:
      console.error(`Unknown token action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

export async function handleTokenCreate(
  args: readonly string[],
): Promise<void> {
  const name = getArgValue(args, "--name");
  if (name === undefined || name.trim().length === 0) {
    console.error(
      "Usage: codex-agent token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]",
    );
    process.exitCode = 1;
    return;
  }

  const permissionsCsv = getArgValue(args, "--permissions");
  const expiresAt = getArgValue(args, "--expires-at");
  const permissions =
    permissionsCsv !== undefined
      ? parsePermissionList(permissionsCsv)
      : DEFAULT_TOKEN_PERMISSIONS;

  if (permissions.length === 0) {
    console.error(
      `No valid permissions provided. Allowed: ${PERMISSIONS.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const token = await createToken({
      name,
      permissions,
      expiresAt,
    });
    console.log("Token created:");
    console.log(token);
  } catch (err: unknown) {
    console.error(
      `Failed to create token: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

export async function handleTokenList(args: readonly string[]): Promise<void> {
  const format = getArgValue(args, "--format") ?? "table";
  const tokens = await listTokens();

  if (tokens.length === 0) {
    console.log("No tokens found.");
    return;
  }

  if (format === "json") {
    console.log(JSON.stringify(tokens, null, 2));
    return;
  }

  const rows = tokens.map((token) => ({
    id: token.id.slice(0, 8),
    name: token.name,
    permissions: token.permissions.join(","),
    expires: token.expiresAt ?? "-",
    revoked: token.revokedAt ?? "-",
  }));

  const headers = {
    id: "ID",
    name: "NAME",
    permissions: "PERMISSIONS",
    expires: "EXPIRES_AT",
    revoked: "REVOKED_AT",
  };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((col) => [
      col,
      Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0),
    ]),
  );
  const headerLine = cols
    .map((c) => headers[c].padEnd(widths[c] ?? 0))
    .join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) =>
    cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "),
  );
  console.log([headerLine, separator, ...dataLines].join("\n"));
}

export async function handleTokenRevoke(
  args: readonly string[],
): Promise<void> {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent token revoke <id>");
    process.exitCode = 1;
    return;
  }

  const ok = await revokeToken(id);
  if (!ok) {
    console.error(`Token not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Token revoked: ${id}`);
}

export async function handleTokenRotate(
  args: readonly string[],
): Promise<void> {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent token rotate <id>");
    process.exitCode = 1;
    return;
  }

  try {
    const token = await rotateToken(id);
    console.log("Token rotated:");
    console.log(token);
  } catch (err: unknown) {
    console.error(
      `Failed to rotate token: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}
