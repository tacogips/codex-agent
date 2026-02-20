import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadQueues,
  saveQueues,
  createQueue,
  addPrompt,
  removeQueue,
  findQueue,
  listQueues,
  updateQueuePrompts,
} from "./repository";

describe("QueueRepository", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-queue-test-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  describe("loadQueues / saveQueues", () => {
    it("returns empty config when file does not exist", async () => {
      const config = await loadQueues(configDir);
      expect(config.queues).toEqual([]);
    });

    it("persists and loads queues", async () => {
      await saveQueues(
        {
          queues: [
            {
              id: "q1",
              name: "test",
              projectPath: "/project",
              prompts: [],
              createdAt: "2026-02-20T00:00:00.000Z",
            },
          ],
        },
        configDir,
      );

      const config = await loadQueues(configDir);
      expect(config.queues).toHaveLength(1);
      expect(config.queues[0]!.name).toBe("test");
    });

    it("writes valid JSON", async () => {
      await saveQueues({ queues: [] }, configDir);
      const raw = await readFile(join(configDir, "queues.json"), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe("createQueue", () => {
    it("creates a queue with generated ID", async () => {
      const queue = await createQueue("my-queue", "/project/path", configDir);
      expect(queue.id).toBeTruthy();
      expect(queue.name).toBe("my-queue");
      expect(queue.projectPath).toBe("/project/path");
      expect(queue.prompts).toEqual([]);
    });

    it("persists the queue", async () => {
      await createQueue("persisted", "/path", configDir);
      const queues = await listQueues(configDir);
      expect(queues).toHaveLength(1);
      expect(queues[0]!.name).toBe("persisted");
    });
  });

  describe("addPrompt", () => {
    it("adds a prompt to a queue", async () => {
      const queue = await createQueue("with-prompts", "/path", configDir);
      const prompt = await addPrompt(queue.id, "Do something", configDir);

      expect(prompt.id).toBeTruthy();
      expect(prompt.prompt).toBe("Do something");
      expect(prompt.status).toBe("pending");

      const found = await findQueue(queue.id, configDir);
      expect(found!.prompts).toHaveLength(1);
      expect(found!.prompts[0]!.prompt).toBe("Do something");
    });

    it("adds multiple prompts", async () => {
      const queue = await createQueue("multi", "/path", configDir);
      await addPrompt(queue.id, "First", configDir);
      await addPrompt(queue.id, "Second", configDir);

      const found = await findQueue(queue.id, configDir);
      expect(found!.prompts).toHaveLength(2);
    });
  });

  describe("removeQueue", () => {
    it("removes an existing queue", async () => {
      const queue = await createQueue("to-remove", "/path", configDir);
      const removed = await removeQueue(queue.id, configDir);
      expect(removed).toBe(true);

      const queues = await listQueues(configDir);
      expect(queues).toHaveLength(0);
    });

    it("returns false for non-existent queue", async () => {
      const removed = await removeQueue("nonexistent", configDir);
      expect(removed).toBe(false);
    });
  });

  describe("findQueue", () => {
    it("finds by ID", async () => {
      const queue = await createQueue("findable", "/path", configDir);
      const found = await findQueue(queue.id, configDir);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(queue.id);
    });

    it("finds by name", async () => {
      await createQueue("by-name", "/path", configDir);
      const found = await findQueue("by-name", configDir);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("by-name");
    });

    it("returns null for not found", async () => {
      const found = await findQueue("nope", configDir);
      expect(found).toBeNull();
    });
  });

  describe("updateQueuePrompts", () => {
    it("updates prompt statuses", async () => {
      const queue = await createQueue("updateable", "/path", configDir);
      const prompt = await addPrompt(queue.id, "Test", configDir);

      const updatedPrompts = [
        {
          ...prompt,
          status: "completed" as const,
          result: { exitCode: 0 },
          completedAt: new Date(),
        },
      ];
      await updateQueuePrompts(queue.id, updatedPrompts, configDir);

      const found = await findQueue(queue.id, configDir);
      expect(found!.prompts[0]!.status).toBe("completed");
      expect(found!.prompts[0]!.result).toEqual({ exitCode: 0 });
    });
  });
});
