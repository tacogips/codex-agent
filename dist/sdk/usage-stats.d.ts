export interface ModelUsageStats {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly cacheCreationInputTokens: number;
}
export interface DailyActivity {
    readonly date: string;
    readonly messageCount?: number;
    readonly sessionCount?: number;
    readonly toolCallCount?: number;
    readonly tokensByModel?: Record<string, number>;
}
export interface CodexUsageStats {
    readonly totalSessions: number;
    readonly totalMessages: number;
    readonly firstSessionDate: string | null;
    readonly lastComputedDate: string | null;
    readonly modelUsage: Record<string, ModelUsageStats>;
    readonly recentDailyActivity: DailyActivity[];
}
export interface GetCodexUsageStatsOptions {
    readonly codexSessionsDir?: string;
    readonly recentDays?: number;
    readonly now?: Date | number;
}
export declare function getCodexUsageStats(options?: GetCodexUsageStatsOptions): Promise<CodexUsageStats | null>;
//# sourceMappingURL=usage-stats.d.ts.map