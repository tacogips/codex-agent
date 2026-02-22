/**
 * Optional Bearer token authentication and permission checks.
 */

import { hasPermission, verifyToken } from "../auth/index";
import type { Permission } from "../auth/index";
import type { ServerConfig } from "./types";

export interface AuthContext {
  readonly source: "static" | "managed";
  readonly tokenId?: string | undefined;
  readonly permissions: readonly Permission[];
}

const FULL_PERMISSIONS: readonly Permission[] = [
  "session:create",
  "session:read",
  "session:cancel",
  "group:*",
  "queue:*",
  "bookmark:*",
];

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function forbiddenResponse(permission: Permission): Response {
  return new Response(
    JSON.stringify({ error: `Forbidden: missing permission ${permission}` }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function parseBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (header === null || !header.startsWith("Bearer ")) {
    return null;
  }
  const value = header.slice("Bearer ".length).trim();
  return value.length === 0 ? null : value;
}

export async function authenticateRequest(
  req: Request,
  config: ServerConfig,
): Promise<{ context: AuthContext | null; error: Response | null }> {
  const bearer = parseBearerToken(req);

  // Legacy static token mode keeps strict auth behavior.
  if (config.token !== undefined) {
    if (bearer === null || bearer !== config.token) {
      return { context: null, error: unauthorizedResponse() };
    }
    return {
      context: { source: "static", permissions: FULL_PERMISSIONS },
      error: null,
    };
  }

  // If no header and no static token, keep server open by default.
  if (bearer === null) {
    return { context: null, error: null };
  }

  // Managed token mode (header provided).
  const result = await verifyToken(bearer, config.configDir);
  if (!result.ok || result.metadata === undefined) {
    return { context: null, error: unauthorizedResponse() };
  }

  return {
    context: {
      source: "managed",
      tokenId: result.metadata.id,
      permissions: result.metadata.permissions,
    },
    error: null,
  };
}

export function ensurePermission(
  context: AuthContext | null,
  required: Permission | undefined,
): Response | null {
  if (required === undefined) {
    return null;
  }
  if (context === null) {
    // Backward compatibility: no token supplied, open server mode.
    return null;
  }
  if (!hasPermission(context.permissions, required)) {
    return forbiddenResponse(required);
  }
  return null;
}

// Backward-compatible helper used by existing unit tests.
export function checkAuth(req: Request, token: string | undefined): Response | null {
  if (token === undefined) return null;

  const bearer = parseBearerToken(req);
  if (bearer === null || bearer !== token) {
    return unauthorizedResponse();
  }
  return null;
}
