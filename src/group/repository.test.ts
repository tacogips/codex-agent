import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadGroups,
  saveGroups,
  addGroup,
  removeGroup,
  findGroup,
  listGroups,
  addSessionToGroup,
  removeSessionFromGroup,
} from "./repository";

describe("GroupRepository", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-group-test-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  describe("loadGroups / saveGroups", () => {
    it("returns empty config when file does not exist", async () => {
      const config = await loadGroups(configDir);
      expect(config.groups).toEqual([]);
    });

    it("persists and loads groups", async () => {
      await saveGroups(
        {
          groups: [
            {
              id: "g1",
              name: "test",
              sessionIds: ["s1"],
              createdAt: "2026-02-20T00:00:00.000Z",
              updatedAt: "2026-02-20T00:00:00.000Z",
            },
          ],
        },
        configDir,
      );

      const config = await loadGroups(configDir);
      expect(config.groups).toHaveLength(1);
      expect(config.groups[0]!.name).toBe("test");
    });

    it("writes valid JSON", async () => {
      await saveGroups({ groups: [] }, configDir);
      const raw = await readFile(join(configDir, "groups.json"), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe("addGroup", () => {
    it("creates a group with generated ID", async () => {
      const group = await addGroup("my-group", "A test group", configDir);
      expect(group.id).toBeTruthy();
      expect(group.name).toBe("my-group");
      expect(group.description).toBe("A test group");
      expect(group.sessionIds).toEqual([]);
    });

    it("persists the group", async () => {
      await addGroup("persisted", undefined, configDir);
      const groups = await listGroups(configDir);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.name).toBe("persisted");
    });

    it("can add multiple groups", async () => {
      await addGroup("group-a", undefined, configDir);
      await addGroup("group-b", undefined, configDir);
      const groups = await listGroups(configDir);
      expect(groups).toHaveLength(2);
    });
  });

  describe("removeGroup", () => {
    it("removes an existing group", async () => {
      const group = await addGroup("to-remove", undefined, configDir);
      const removed = await removeGroup(group.id, configDir);
      expect(removed).toBe(true);

      const groups = await listGroups(configDir);
      expect(groups).toHaveLength(0);
    });

    it("returns false for non-existent group", async () => {
      const removed = await removeGroup("nonexistent", configDir);
      expect(removed).toBe(false);
    });
  });

  describe("findGroup", () => {
    it("finds by ID", async () => {
      const group = await addGroup("findable", undefined, configDir);
      const found = await findGroup(group.id, configDir);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(group.id);
    });

    it("finds by name", async () => {
      await addGroup("by-name", undefined, configDir);
      const found = await findGroup("by-name", configDir);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("by-name");
    });

    it("returns null for not found", async () => {
      const found = await findGroup("nope", configDir);
      expect(found).toBeNull();
    });
  });

  describe("addSessionToGroup / removeSessionFromGroup", () => {
    it("adds a session to a group", async () => {
      const group = await addGroup("sessions-test", undefined, configDir);
      await addSessionToGroup(group.id, "session-1", configDir);

      const found = await findGroup(group.id, configDir);
      expect(found?.sessionIds).toContain("session-1");
    });

    it("does not duplicate session IDs", async () => {
      const group = await addGroup("no-dup", undefined, configDir);
      await addSessionToGroup(group.id, "session-1", configDir);
      await addSessionToGroup(group.id, "session-1", configDir);

      const found = await findGroup(group.id, configDir);
      expect(found!.sessionIds).toEqual(["session-1"]);
    });

    it("removes a session from a group", async () => {
      const group = await addGroup("remove-session", undefined, configDir);
      await addSessionToGroup(group.id, "session-1", configDir);
      await addSessionToGroup(group.id, "session-2", configDir);
      await removeSessionFromGroup(group.id, "session-1", configDir);

      const found = await findGroup(group.id, configDir);
      expect(found!.sessionIds).toEqual(["session-2"]);
    });
  });
});
