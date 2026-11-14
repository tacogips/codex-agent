import type { ExecutionResult } from "graphql";

export interface GraphqlExecutionContext {
  readonly codexHome?: string | undefined;
  readonly configDir?: string | undefined;
}

export interface GraphqlExecutionRequest {
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
  readonly context?: GraphqlExecutionContext | undefined;
}

export type GraphqlOperationResult =
  | ExecutionResult
  | AsyncIterable<ExecutionResult>;
