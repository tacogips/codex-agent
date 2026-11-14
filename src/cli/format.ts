/**
 * CLI output formatting utilities.
 */

import type { CodexSession } from "../types/session";
import type { MessageProvenance, RolloutLine } from "../types/rollout";

/**
 * Format a session list as a table for terminal output.
 */
export function formatSessionTable(sessions: readonly CodexSession[]): string {
  if (sessions.length === 0) {
    return "No sessions found.";
  }

  const rows = sessions.map((s) => ({
    id: s.id.slice(0, 8),
    source: s.source,
    cwd: truncate(s.cwd, 40),
    title: truncate(s.title, 50),
    created: formatDate(s.createdAt),
    branch: s.git?.branch ?? "-",
  }));

  const headers = {
    id: "ID",
    source: "SOURCE",
    cwd: "CWD",
    title: "TITLE",
    created: "CREATED",
    branch: "BRANCH",
  };
  const cols = Object.keys(headers) as (keyof typeof headers)[];

  const widths: Record<string, number> = {};
  for (const col of cols) {
    const headerLen = headers[col].length;
    const maxRow = Math.max(...rows.map((r) => r[col].length));
    widths[col] = Math.max(headerLen, maxRow);
  }

  const headerLine = cols
    .map((c) => headers[c].padEnd(widths[c] ?? 0))
    .join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) =>
    cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "),
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

/**
 * Format a single session as detailed text.
 */
export function formatSessionDetail(session: CodexSession): string {
  const lines = [
    `Session: ${session.id}`,
    `  Source:    ${session.source}`,
    `  CWD:      ${session.cwd}`,
    `  CLI:      ${session.cliVersion}`,
    `  Model:    ${session.modelProvider ?? "unknown"}`,
    `  Created:  ${session.createdAt.toISOString()}`,
    `  Updated:  ${session.updatedAt.toISOString()}`,
    `  Title:    ${session.title}`,
    `  Path:     ${session.rolloutPath}`,
  ];

  if (session.git !== undefined) {
    lines.push(`  Branch:   ${session.git.branch ?? "-"}`);
    lines.push(`  SHA:      ${session.git.sha ?? "-"}`);
    lines.push(`  Origin:   ${session.git.origin_url ?? "-"}`);
  }

  if (session.forkedFromId !== undefined) {
    lines.push(`  Forked:   ${session.forkedFromId}`);
  }

  if (session.archivedAt !== undefined) {
    lines.push(`  Archived: ${session.archivedAt.toISOString()}`);
  }

  return lines.join("\n");
}

/**
 * Format a rollout line for watch output.
 */
export function formatRolloutLine(line: RolloutLine): string {
  const ts = line.timestamp;
  const payload = line.payload as Record<string, unknown>;
  const eventType = (payload["type"] as string | undefined) ?? "";
  const suffix = formatProvenanceSuffix(line.provenance);

  switch (line.type) {
    case "event_msg":
      return `${formatEventMsg(ts, eventType, payload)}${suffix}`;
    case "response_item":
      return `[${ts}] response: ${eventType}${suffix}`;
    case "session_meta":
      return `[${ts}] session started${suffix}`;
    case "turn_context":
      return `[${ts}] turn context: model=${String(payload["model"] ?? "?")}${suffix}`;
    case "compacted":
      return `[${ts}] context compacted${suffix}`;
    default:
      return `[${ts}] ${line.type}${suffix}`;
  }
}

/**
 * Format sessions as JSON.
 */
export function formatSessionsJson(sessions: readonly CodexSession[]): string {
  return JSON.stringify(sessions, null, 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEventMsg(
  ts: string,
  eventType: string,
  payload: Record<string, unknown>,
): string {
  switch (eventType) {
    case "UserMessage":
      return `[${ts}] user: ${truncate(String(payload["message"] ?? ""), 80)}`;
    case "AgentMessage":
      return `[${ts}] agent: ${truncate(String(payload["message"] ?? ""), 80)}`;
    case "TurnStarted":
      return `[${ts}] turn started: ${String(payload["turn_id"] ?? "")}`;
    case "TurnComplete":
      return `[${ts}] turn complete: ${String(payload["turn_id"] ?? "")}`;
    case "ExecCommandBegin": {
      const cmd = payload["command"];
      return `[${ts}] exec: ${Array.isArray(cmd) ? cmd.join(" ") : String(cmd ?? "")}`;
    }
    case "ExecCommandEnd": {
      const code = payload["exit_code"];
      return `[${ts}] exec done: exit=${String(code ?? "?")}`;
    }
    case "TokenCount": {
      const total = payload["total_tokens"];
      return `[${ts}] tokens: ${String(total ?? "?")}`;
    }
    case "Error":
      return `[${ts}] ERROR: ${String(payload["message"] ?? "")}`;
    default:
      return `[${ts}] event: ${eventType}`;
  }
}

function formatProvenanceSuffix(
  provenance: MessageProvenance | undefined,
): string {
  if (provenance === undefined) {
    return "";
  }
  const fields = [`origin=${provenance.origin}`];
  if (provenance.role !== undefined) {
    fields.push(`role=${provenance.role}`);
  }
  if (provenance.source_tag !== undefined) {
    fields.push(`tag=${provenance.source_tag}`);
  }
  if (!provenance.display_default) {
    fields.push("display_default=false");
  }
  return ` {${fields.join(", ")}}`;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max - 3) + "...";
}
