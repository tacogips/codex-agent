import type { GraphqlExecutionContext } from "./types";
export declare function executeCommand(name: string, params: unknown, context: GraphqlExecutionContext): Promise<unknown>;
export declare function subscribeCommand(name: string, params: unknown, context: GraphqlExecutionContext): Promise<AsyncIterable<unknown>>;
//# sourceMappingURL=command-handlers.d.ts.map