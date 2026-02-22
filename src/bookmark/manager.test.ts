import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addBookmark,
  deleteBookmark,
  getBookmark,
  listBookmarks,
  searchBookmarks,
} from "./manager";

describe("BookmarkManager", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-bookmark-test-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates and retrieves a session bookmark", async () => {
    const created = await addBookmark(
      {
        type: "session",
        sessionId: "session-1",
        name: "important session",
        tags: ["priority", "review"],
      },
      configDir,
    );

    const found = await getBookmark(created.id, configDir);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("important session");
    expect(found!.tags).toEqual(["priority", "review"]);
  });

  it("validates type-specific fields", async () => {
    await expect(
      addBookmark(
        {
          type: "message",
          sessionId: "session-1",
          name: "missing message id",
        },
        configDir,
      ),
    ).rejects.toThrow("messageId is required");
  });

  it("filters bookmarks by session/type/tag", async () => {
    await addBookmark(
      {
        type: "session",
        sessionId: "s1",
        name: "session one",
        tags: ["alpha"],
      },
      configDir,
    );
    await addBookmark(
      {
        type: "message",
        sessionId: "s2",
        messageId: "m-1",
        name: "message two",
        tags: ["beta"],
      },
      configDir,
    );

    const bySession = await listBookmarks({ sessionId: "s1" }, configDir);
    expect(bySession).toHaveLength(1);
    expect(bySession[0]!.sessionId).toBe("s1");

    const byType = await listBookmarks({ type: "message" }, configDir);
    expect(byType).toHaveLength(1);
    expect(byType[0]!.type).toBe("message");

    const byTag = await listBookmarks({ tag: "beta" }, configDir);
    expect(byTag).toHaveLength(1);
    expect(byTag[0]!.name).toBe("message two");
  });

  it("searches bookmarks by text relevance", async () => {
    const top = await addBookmark(
      {
        type: "session",
        sessionId: "s-top",
        name: "Production Incident Follow-up",
        description: "Detailed postmortem and next actions",
        tags: ["incident", "urgent"],
      },
      configDir,
    );
    await addBookmark(
      {
        type: "session",
        sessionId: "s-low",
        name: "Weekly notes",
        description: "General backlog cleanups",
      },
      configDir,
    );

    const result = await searchBookmarks("incident", undefined, configDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.bookmark.id).toBe(top.id);
    expect(result[0]!.score).toBeGreaterThan(0);
  });

  it("deletes an existing bookmark", async () => {
    const created = await addBookmark(
      {
        type: "range",
        sessionId: "s-range",
        fromMessageId: "m-1",
        toMessageId: "m-9",
        name: "range",
      },
      configDir,
    );

    const deleted = await deleteBookmark(created.id, configDir);
    expect(deleted).toBe(true);

    const found = await getBookmark(created.id, configDir);
    expect(found).toBeNull();
  });
});

