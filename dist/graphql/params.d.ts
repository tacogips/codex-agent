import { type ValueNode } from "graphql";
import type { CodexProcessOptions } from "../process/types";
export interface RecordLike {
    readonly [key: string]: unknown;
}
export declare function parseJsonLiteral(ast: ValueNode): unknown;
export declare function toRecord(value: unknown, label?: string): RecordLike;
export declare function readString(record: RecordLike, key: string): string | undefined;
export declare function readNumber(record: RecordLike, key: string): number | undefined;
export declare function readBoolean(record: RecordLike, key: string): boolean | undefined;
export declare function readStringArray(record: RecordLike, key: string): readonly string[] | undefined;
export declare function readStringUnion<const T extends readonly string[]>(record: RecordLike, key: string, allowedValues: T): T[number] | undefined;
export declare function requireStringUnion<const T extends readonly string[]>(record: RecordLike, key: string, allowedValues: T): T[number];
export declare function requireString(record: RecordLike, key: string): string;
export declare function requireNumber(record: RecordLike, key: string): number;
export declare function readProcessOptions(record: RecordLike): CodexProcessOptions;
export declare function extractSessionId(lines: readonly unknown[]): string | undefined;
//# sourceMappingURL=params.d.ts.map