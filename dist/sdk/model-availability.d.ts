export interface CodexLoginStatusInfo {
    readonly ok: boolean;
    readonly status: string | null;
    readonly error: string | null;
    readonly exitCode: number | null;
}
export interface GetCodexLoginStatusOptions {
    readonly codexBinary?: string | undefined;
    readonly cwd?: string | undefined;
    readonly timeoutMs?: number | undefined;
}
export interface CodexModelProbeInfo {
    readonly ok: boolean;
    readonly model: string;
    readonly output: string | null;
    readonly error: string | null;
    readonly exitCode: number | null;
}
export interface CheckCodexModelAvailabilityOptions extends GetCodexLoginStatusOptions {
    readonly model: string;
    readonly prompt?: string | undefined;
}
export interface CodexModelAvailabilityResult {
    readonly ok: boolean;
    readonly model: string;
    readonly auth: CodexLoginStatusInfo;
    readonly probe: CodexModelProbeInfo;
}
export declare function getCodexLoginStatus(options?: GetCodexLoginStatusOptions): Promise<CodexLoginStatusInfo>;
export declare function checkCodexModelAvailability(options: CheckCodexModelAvailabilityOptions): Promise<CodexModelAvailabilityResult>;
//# sourceMappingURL=model-availability.d.ts.map