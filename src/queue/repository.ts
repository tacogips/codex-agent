/**
 * QueueRepository - Persistent storage for queue definitions.
 *
 * Stores queues as JSON at ~/.config/codex-agent/queues.json.
 * Uses atomic write (write-to-temp + rename) for crash safety.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  PromptQueue,
  PromptQueueData,
  QueuePrompt,
  QueuePromptData,
  QueueConfig,
} from "./types";

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "codex-agent");
const QUEUES_FILE = "queues.json";

function resolveConfigDir(configDir?: string): string {
  return configDir ?? DEFAULT_CONFIG_DIR;
}

function queueFilePath(configDir?: string): string {
  return join(resolveConfigDir(configDir), QUEUES_FILE);
}

function toPrompt(data: QueuePromptData): QueuePrompt {
  return {
    id: data.id,
    prompt: data.prompt,
    status: data.status,
    result: data.result,
    addedAt: new Date(data.addedAt),
    startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
    completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
  };
}

function toPromptData(prompt: QueuePrompt): QueuePromptData {
  return {
    id: prompt.id,
    prompt: prompt.prompt,
    status: prompt.status,
    result: prompt.result,
    addedAt: prompt.addedAt.toISOString(),
    startedAt: prompt.startedAt?.toISOString(),
    completedAt: prompt.completedAt?.toISOString(),
  };
}

function toQueue(data: PromptQueueData): PromptQueue {
  return {
    id: data.id,
    name: data.name,
    projectPath: data.projectPath,
    prompts: data.prompts.map(toPrompt),
    createdAt: new Date(data.createdAt),
  };
}

function toQueueData(queue: PromptQueue): PromptQueueData {
  return {
    id: queue.id,
    name: queue.name,
    projectPath: queue.projectPath,
    prompts: queue.prompts.map(toPromptData),
    createdAt: queue.createdAt.toISOString(),
  };
}

/**
 * Load all queues from persistent storage.
 */
export async function loadQueues(configDir?: string): Promise<QueueConfig> {
  const path = queueFilePath(configDir);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as QueueConfig;
  } catch {
    return { queues: [] };
  }
}

/**
 * Persist queues to storage using atomic write.
 */
export async function saveQueues(config: QueueConfig, configDir?: string): Promise<void> {
  const dir = resolveConfigDir(configDir);
  await mkdir(dir, { recursive: true });
  const path = queueFilePath(configDir);
  const tmpPath = path + ".tmp." + randomUUID().slice(0, 8);
  const json = JSON.stringify(config, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}

/**
 * Create a new queue.
 */
export async function createQueue(
  name: string,
  projectPath: string,
  configDir?: string,
): Promise<PromptQueue> {
  const config = await loadQueues(configDir);
  const queue: PromptQueue = {
    id: randomUUID(),
    name,
    projectPath,
    prompts: [],
    createdAt: new Date(),
  };
  const newConfig: QueueConfig = {
    queues: [...config.queues, toQueueData(queue)],
  };
  await saveQueues(newConfig, configDir);
  return queue;
}

/**
 * Add a prompt to a queue.
 */
export async function addPrompt(
  queueId: string,
  prompt: string,
  configDir?: string,
): Promise<QueuePrompt> {
  const config = await loadQueues(configDir);
  const newPrompt: QueuePromptData = {
    id: randomUUID(),
    prompt,
    status: "pending",
    addedAt: new Date().toISOString(),
  };
  const newQueues = config.queues.map((q) => {
    if (q.id !== queueId) return q;
    return { ...q, prompts: [...q.prompts, newPrompt] };
  });
  await saveQueues({ queues: newQueues }, configDir);
  return toPrompt(newPrompt);
}

/**
 * Delete a queue by ID.
 */
export async function removeQueue(
  id: string,
  configDir?: string,
): Promise<boolean> {
  const config = await loadQueues(configDir);
  const filtered = config.queues.filter((q) => q.id !== id);
  if (filtered.length === config.queues.length) {
    return false;
  }
  await saveQueues({ queues: filtered }, configDir);
  return true;
}

/**
 * Find a queue by ID or name.
 */
export async function findQueue(
  idOrName: string,
  configDir?: string,
): Promise<PromptQueue | null> {
  const config = await loadQueues(configDir);
  const data = config.queues.find((q) => q.id === idOrName || q.name === idOrName);
  return data ? toQueue(data) : null;
}

/**
 * List all queues.
 */
export async function listQueues(configDir?: string): Promise<readonly PromptQueue[]> {
  const config = await loadQueues(configDir);
  return config.queues.map(toQueue);
}

/**
 * Update a queue's prompt statuses in storage.
 */
export async function updateQueuePrompts(
  queueId: string,
  prompts: readonly QueuePrompt[],
  configDir?: string,
): Promise<void> {
  const config = await loadQueues(configDir);
  const newQueues = config.queues.map((q) => {
    if (q.id !== queueId) return q;
    return { ...q, prompts: prompts.map(toPromptData) };
  });
  await saveQueues({ queues: newQueues }, configDir);
}
