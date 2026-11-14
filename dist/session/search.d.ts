import type { SessionTranscriptSearchOptions, SessionTranscriptSearchResult, SessionsSearchOptions, SessionsSearchResult } from "../types/session";
/**
 * Search transcript text inside a single session.
 */
export declare function searchSessionTranscript(sessionId: string, query: string, options?: SessionTranscriptSearchOptions & {
    codexHome?: string;
}): Promise<SessionTranscriptSearchResult>;
/**
 * Search transcripts across sessions and return matching session IDs.
 */
export declare function searchSessions(query: string, options?: SessionsSearchOptions & {
    codexHome?: string;
}): Promise<SessionsSearchResult>;
//# sourceMappingURL=search.d.ts.map