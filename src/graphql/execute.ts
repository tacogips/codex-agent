import {
  GraphQLError,
  execute,
  getOperationAST,
  parse,
  subscribe,
  validate,
  type DocumentNode,
  type ExecutionResult,
} from "graphql";
import { getGraphqlSchema } from "./schema";
import type { GraphqlExecutionRequest, GraphqlOperationResult } from "./types";

function toErrorResult(error: GraphQLError): ExecutionResult {
  return {
    errors: [error],
  };
}

function isAsyncIterable<T>(
  value: T | AsyncIterable<T>,
): value is AsyncIterable<T> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

export async function executeGraphqlOperation(
  request: GraphqlExecutionRequest,
): Promise<GraphqlOperationResult> {
  let document: DocumentNode;
  try {
    document = parse(request.document);
  } catch (error: unknown) {
    return toErrorResult(
      error instanceof GraphQLError ? error : new GraphQLError(String(error)),
    );
  }

  const schema = getGraphqlSchema();
  const validationErrors = validate(schema, document);
  if (validationErrors.length > 0) {
    return {
      errors: validationErrors,
    };
  }

  const operation = getOperationAST(document);
  if (operation?.operation === "subscription") {
    return subscribe({
      schema,
      document,
      variableValues: request.variables,
      contextValue: request.context ?? {},
    });
  }

  return execute({
    schema,
    document,
    variableValues: request.variables,
    contextValue: request.context ?? {},
  });
}

export async function executeGraphqlDocument(
  request: GraphqlExecutionRequest,
): Promise<ExecutionResult> {
  const result = await executeGraphqlOperation(request);
  if (isAsyncIterable(result)) {
    throw new GraphQLError(
      "Subscriptions must be executed with executeGraphqlOperation",
    );
  }
  return result;
}
