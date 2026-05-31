interface GraphqlCliArgs {
    readonly document: string;
    readonly variables?: Readonly<Record<string, unknown>> | undefined;
}
export declare function runGraphqlCli(args: readonly string[], options?: {
    readonly codexHome?: string | undefined;
    readonly configDir?: string | undefined;
}): Promise<void>;
export declare function parseGraphqlCliArgs(args: readonly string[]): Promise<GraphqlCliArgs>;
export declare function normalizeGraphqlDocument(input: string): string;
export {};
//# sourceMappingURL=graphql.d.ts.map