import type { ApiTokenMetadata, CreateTokenInput, TokenConfig, VerifyTokenResult } from "./types";
export declare function loadTokenConfig(configDir?: string): Promise<TokenConfig>;
export declare function saveTokenConfig(config: TokenConfig, configDir?: string): Promise<void>;
export declare function createToken(input: CreateTokenInput, configDir?: string): Promise<string>;
export declare function listTokens(configDir?: string): Promise<readonly ApiTokenMetadata[]>;
export declare function revokeToken(id: string, configDir?: string): Promise<boolean>;
export declare function rotateToken(id: string, configDir?: string): Promise<string>;
export declare function verifyToken(rawToken: string, configDir?: string): Promise<VerifyTokenResult>;
//# sourceMappingURL=token-manager.d.ts.map