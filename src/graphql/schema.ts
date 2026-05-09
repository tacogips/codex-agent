import {
  GraphQLBoolean,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { parseJsonLiteral } from "./params";
import { executeCommand, subscribeCommand } from "./command-handlers";
import type { GraphqlExecutionContext } from "./types";

const JSON_SCALAR = new GraphQLScalarType({
  name: "JSON",
  serialize(value: unknown): unknown {
    return value;
  },
  parseValue(value: unknown): unknown {
    return value;
  },
  parseLiteral(ast) {
    return parseJsonLiteral(ast);
  },
});

const QUERY_TYPE = new GraphQLObjectType<GraphqlExecutionContext>({
  name: "Query",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR },
      },
      async resolve(_source, args, context) {
        return executeCommand(args.name, args.params, context);
      },
    },
    ping: {
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve() {
        return true;
      },
    },
  },
});

const MUTATION_TYPE = new GraphQLObjectType<GraphqlExecutionContext>({
  name: "Mutation",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR },
      },
      async resolve(_source, args, context) {
        return executeCommand(args.name, args.params, context);
      },
    },
  },
});

const SUBSCRIPTION_TYPE = new GraphQLObjectType<GraphqlExecutionContext>({
  name: "Subscription",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR },
      },
      async subscribe(_source, args, context) {
        return subscribeCommand(args.name, args.params, context);
      },
      resolve(payload) {
        return payload;
      },
    },
  },
});

const SCHEMA = new GraphQLSchema({
  query: QUERY_TYPE,
  mutation: MUTATION_TYPE,
  subscription: SUBSCRIPTION_TYPE,
});

export function getGraphqlSchema(): GraphQLSchema {
  return SCHEMA;
}
