export declare const PERMISSIONS: readonly ["session:create", "session:read", "session:cancel", "group:*", "queue:*", "bookmark:*"];
export type Permission = (typeof PERMISSIONS)[number];
export declare const ALL_PERMISSIONS: readonly Permission[];
export declare const DEFAULT_TOKEN_PERMISSIONS: readonly ["session:read"];
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
export declare function isPermission(value: string): value is Permission;
export declare function normalizePermissions(values: readonly string[]): readonly Permission[];
export declare function parsePermissionList(input: string): readonly Permission[];
export declare function hasPermission(granted: readonly Permission[], required: Permission): boolean;
//# sourceMappingURL=types.d.ts.map