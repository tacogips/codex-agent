export const PERMISSIONS = [
  "session:create",
  "session:read",
  "session:cancel",
  "group:*",
  "queue:*",
  "bookmark:*",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

export const DEFAULT_TOKEN_PERMISSIONS = [
  "session:read",
] as const satisfies readonly Permission[];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export interface ApiTokenMetadata {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
  readonly createdAt: string;
  readonly expiresAt?: string | undefined;
  readonly revokedAt?: string | undefined;
}

export interface CreateTokenInput {
  readonly name: string;
  readonly permissions: readonly Permission[];
  readonly expiresAt?: string | undefined;
}

export interface TokenRecord extends ApiTokenMetadata {
  readonly tokenHash: string;
}

export interface TokenConfig {
  readonly tokens: readonly TokenRecord[];
}

export interface VerifyTokenResult {
  readonly ok: boolean;
  readonly metadata?: ApiTokenMetadata | undefined;
}

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

export function normalizePermissions(
  values: readonly string[],
): readonly Permission[] {
  const unique = new Set<Permission>();
  for (const value of values) {
    const trimmed = value.trim();
    if (isPermission(trimmed)) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique);
}

export function parsePermissionList(input: string): readonly Permission[] {
  return normalizePermissions(input.split(","));
}

export function hasPermission(
  granted: readonly Permission[],
  required: Permission,
): boolean {
  if (granted.includes(required)) {
    return true;
  }
  if (required.startsWith("group:") && granted.includes("group:*")) {
    return true;
  }
  if (required.startsWith("queue:") && granted.includes("queue:*")) {
    return true;
  }
  if (required.startsWith("bookmark:") && granted.includes("bookmark:*")) {
    return true;
  }
  return false;
}
