export declare function handleVersion(args: readonly string[]): Promise<void>;
export declare function parseVersionArgs(args: readonly string[]): {
    readonly asJson: boolean;
    readonly includeGit: boolean;
};
export interface ModelCheckArgs {
    readonly model?: string;
    readonly asJson: boolean;
    readonly timeoutMs?: number;
}
export declare function handleModel(action: string | undefined, args: readonly string[]): Promise<void>;
export declare function parseModelCheckArgs(args: readonly string[]): ModelCheckArgs;
//# sourceMappingURL=version-model.d.ts.map