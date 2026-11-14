export interface ToolContext {
    readonly sessionId?: string | undefined;
}
export interface ToolConfig<TInput, TOutput> {
    readonly name: string;
    readonly description?: string | undefined;
    readonly run: (input: TInput, context?: ToolContext) => Promise<TOutput> | TOutput;
}
export interface RegisteredTool<TInput, TOutput> {
    readonly name: string;
    readonly description?: string | undefined;
    run(input: TInput, context?: ToolContext): Promise<TOutput>;
}
export declare function tool<TInput, TOutput>(config: ToolConfig<TInput, TOutput>): RegisteredTool<TInput, TOutput>;
export declare class ToolRegistry {
    private readonly tools;
    register<TInput, TOutput>(registeredTool: RegisteredTool<TInput, TOutput>): void;
    get<TInput, TOutput>(name: string): RegisteredTool<TInput, TOutput> | null;
    list(): readonly string[];
    run<TInput, TOutput>(name: string, input: TInput, context?: ToolContext): Promise<TOutput>;
}
//# sourceMappingURL=tool-registry.d.ts.map