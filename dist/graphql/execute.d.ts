import { type ExecutionResult } from "graphql";
import type { GraphqlExecutionRequest, GraphqlOperationResult } from "./types";
export declare function executeGraphqlOperation(request: GraphqlExecutionRequest): Promise<GraphqlOperationResult>;
export declare function executeGraphqlDocument(request: GraphqlExecutionRequest): Promise<ExecutionResult>;
//# sourceMappingURL=execute.d.ts.map