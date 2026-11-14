export interface ToolVersionInfo {
    readonly version: string | null;
    readonly error: string | null;
}
export interface AgentToolVersions {
    readonly codex: ToolVersionInfo;
    readonly git?: ToolVersionInfo;
}
export interface GetCodexCliVersionOptions {
    readonly codexBinary?: string | undefined;
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
    readonly timeoutMs?: number | undefined;
}
export interface GetToolVersionsOptions extends GetCodexCliVersionOptions {
    readonly includeGit?: boolean | undefined;
    readonly gitBinary?: string | undefined;
}
export declare function getCodexCliVersion(options?: GetCodexCliVersionOptions): Promise<ToolVersionInfo>;
export declare function getToolVersions(options?: GetToolVersionsOptions): Promise<AgentToolVersions>;
//# sourceMappingURL=tool-versions.d.ts.map