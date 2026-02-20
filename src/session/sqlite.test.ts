import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openCodexDb,
  listSessionsSqlite,
  findSessionSqlite,
  findLatestSessionSqlite,
} from "./sqlite";

/**
 * Create a temp directory with a SQLite DB matching Codex's threads schema.
 */
async function createTestDb(): Promise<{ dir: string; db: Database }> {
  const dir = await mkdtemp(join(tmpdir(), "codex-agent-sqlite-test-"));
  const dbPath = join(dir, "state");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT,
      cwd TEXT NOT NULL,
      cli_version TEXT NOT NULL,
      title TEXT,
      first_user_message TEXT,
      archived_at TEXT,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT
    )
  `);

  return { dir, db };
}

function insertSession(
  db: Database,
  overrides: Partial<{
    id: string;
    rollout_path: string;
    created_at: string;
    updated_at: string;
    source: string;
    model_provider: string;
    cwd: string;
    cli_version: string;
    title: string;
    first_user_message: string;
    archived_at: string;
    git_sha: string;
    git_branch: string;
    git_origin_url: string;
  }> = {},
): void {
  const defaults = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    rollout_path: "/home/user/.codex/sessions/2026/02/20/rollout-1740000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
    created_at: "2026-02-20T10:00:00Z",
    updated_at: "2026-02-20T10:05:00Z",
    source: "cli",
    model_provider: "anthropic",
    cwd: "/home/user/project",
    cli_version: "1.0.0",
    title: "Test session",
    first_user_message: "Hello",
    archived_at: null,
    git_sha: "abc123",
    git_branch: "main",
    git_origin_url: "https://github.com/user/repo",
  };

  const row = { ...defaults, ...overrides };

  db.query(`
    INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, cli_version, title, first_user_message, archived_at, git_sha, git_branch, git_origin_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.rollout_path, row.created_at, row.updated_at,
    row.source, row.model_provider, row.cwd, row.cli_version,
    row.title, row.first_user_message, row.archived_at,
    row.git_sha, row.git_branch, row.git_origin_url,
  );
}

describe("SQLite Session Index", () => {
  let dir: string;
  let db: Database;

  beforeEach(async () => {
    const result = await createTestDb();
    dir = result.dir;
    db = result.db;
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  describe("openCodexDb", () => {
    it("opens a valid Codex DB", () => {
      const opened = openCodexDb(dir);
      expect(opened).not.toBeNull();
      opened!.close();
    });

    it("returns null for missing DB", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "codex-agent-empty-"));
      const opened = openCodexDb(emptyDir);
      expect(opened).toBeNull();
      await rm(emptyDir, { recursive: true, force: true });
    });

    it("returns null for DB without threads table", async () => {
      const otherDir = await mkdtemp(join(tmpdir(), "codex-agent-nothreads-"));
      const otherDb = new Database(join(otherDir, "state"));
      otherDb.exec("CREATE TABLE other (id TEXT)");
      otherDb.close();

      const opened = openCodexDb(otherDir);
      expect(opened).toBeNull();
      await rm(otherDir, { recursive: true, force: true });
    });
  });

  describe("listSessionsSqlite", () => {
    it("lists all sessions", () => {
      insertSession(db, { id: "id-1", created_at: "2026-02-20T10:00:00Z" });
      insertSession(db, { id: "id-2", created_at: "2026-02-20T11:00:00Z" });

      const result = listSessionsSqlite(db);
      expect(result.total).toBe(2);
      expect(result.sessions).toHaveLength(2);
    });

    it("filters by source", () => {
      insertSession(db, { id: "id-1", source: "cli" });
      insertSession(db, { id: "id-2", source: "vscode" });

      const result = listSessionsSqlite(db, { source: "cli" });
      expect(result.total).toBe(1);
      expect(result.sessions[0]!.id).toBe("id-1");
    });

    it("filters by cwd", () => {
      insertSession(db, { id: "id-1", cwd: "/project/a" });
      insertSession(db, { id: "id-2", cwd: "/project/b" });

      const result = listSessionsSqlite(db, { cwd: "/project/a" });
      expect(result.total).toBe(1);
      expect(result.sessions[0]!.id).toBe("id-1");
    });

    it("filters by branch", () => {
      insertSession(db, { id: "id-1", git_branch: "main" });
      insertSession(db, { id: "id-2", git_branch: "dev" });

      const result = listSessionsSqlite(db, { branch: "main" });
      expect(result.total).toBe(1);
      expect(result.sessions[0]!.id).toBe("id-1");
    });

    it("supports pagination", () => {
      insertSession(db, { id: "id-1", created_at: "2026-02-20T10:00:00Z" });
      insertSession(db, { id: "id-2", created_at: "2026-02-20T11:00:00Z" });
      insertSession(db, { id: "id-3", created_at: "2026-02-20T12:00:00Z" });

      const result = listSessionsSqlite(db, { limit: 2, offset: 0 });
      expect(result.total).toBe(3);
      expect(result.sessions).toHaveLength(2);

      const page2 = listSessionsSqlite(db, { limit: 2, offset: 2 });
      expect(page2.sessions).toHaveLength(1);
    });

    it("sorts by createdAt desc by default", () => {
      insertSession(db, { id: "id-old", created_at: "2026-02-20T08:00:00Z" });
      insertSession(db, { id: "id-new", created_at: "2026-02-20T12:00:00Z" });

      const result = listSessionsSqlite(db);
      expect(result.sessions[0]!.id).toBe("id-new");
      expect(result.sessions[1]!.id).toBe("id-old");
    });

    it("sorts ascending when requested", () => {
      insertSession(db, { id: "id-old", created_at: "2026-02-20T08:00:00Z" });
      insertSession(db, { id: "id-new", created_at: "2026-02-20T12:00:00Z" });

      const result = listSessionsSqlite(db, { sortOrder: "asc" });
      expect(result.sessions[0]!.id).toBe("id-old");
    });

    it("maps git info correctly", () => {
      insertSession(db, {
        id: "id-git",
        git_sha: "deadbeef",
        git_branch: "feature",
        git_origin_url: "https://example.com/repo",
      });

      const result = listSessionsSqlite(db);
      const session = result.sessions[0]!;
      expect(session.git).toEqual({
        sha: "deadbeef",
        branch: "feature",
        origin_url: "https://example.com/repo",
      });
    });

    it("handles sessions without git info", () => {
      insertSession(db, {
        id: "id-nogit",
        git_sha: null as unknown as string,
        git_branch: null as unknown as string,
        git_origin_url: null as unknown as string,
      });

      const result = listSessionsSqlite(db);
      expect(result.sessions[0]!.git).toBeUndefined();
    });
  });

  describe("findSessionSqlite", () => {
    it("finds a session by ID", () => {
      insertSession(db, { id: "target-id" });
      insertSession(db, { id: "other-id" });

      const session = findSessionSqlite(db, "target-id");
      expect(session).not.toBeNull();
      expect(session!.id).toBe("target-id");
    });

    it("returns null for non-existent ID", () => {
      insertSession(db, { id: "exists" });

      const session = findSessionSqlite(db, "not-exists");
      expect(session).toBeNull();
    });
  });

  describe("findLatestSessionSqlite", () => {
    it("finds the most recent session", () => {
      insertSession(db, { id: "id-old", updated_at: "2026-02-20T08:00:00Z" });
      insertSession(db, { id: "id-new", updated_at: "2026-02-20T12:00:00Z" });

      const session = findLatestSessionSqlite(db);
      expect(session).not.toBeNull();
      expect(session!.id).toBe("id-new");
    });

    it("filters by cwd", () => {
      insertSession(db, { id: "id-a", cwd: "/project/a", updated_at: "2026-02-20T12:00:00Z" });
      insertSession(db, { id: "id-b", cwd: "/project/b", updated_at: "2026-02-20T14:00:00Z" });

      const session = findLatestSessionSqlite(db, "/project/a");
      expect(session).not.toBeNull();
      expect(session!.id).toBe("id-a");
    });

    it("returns null when no sessions exist", () => {
      const session = findLatestSessionSqlite(db);
      expect(session).toBeNull();
    });
  });
});
