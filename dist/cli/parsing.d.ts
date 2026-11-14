import type { SessionSource } from "../types/rollout";
import type { CodexProcessOptions } from "../process/types";
interface ListArgs {
    source?: SessionSource | undefined;
    cwd?: string | undefined;
    branch?: string | undefined;
    limit: number;
    format: "table" | "json";
}
export declare function parseListArgs(args: readonly string[]): ListArgs;
export declare function getArgValue(args: readonly string[], flag: string): string | undefined;
export declare function getArgValues(args: readonly string[], flag: string): readonly string[];
export declare function parseProcessOptions(args: readonly string[]): CodexProcessOptions;
export declare function parseCharDelayMs(args: readonly string[]): number;
export declare function isCharChunk(chunk: unknown): chunk is {
    readonly kind: "char";
    readonly char: string;
};
export declare function sleep(ms: number): Promise<void>;
export declare function renderMarkdownTasks(lines: readonly {
    readonly type: string;
    readonly payload: unknown;
}[]): void;
export {};
//# sourceMappingURL=parsing.d.ts.map