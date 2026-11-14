/**
 * GroupRepository - Persistent storage for group definitions.
 *
 * Stores groups as JSON at ~/.config/codex-agent/groups.json.
 * Uses atomic write (write-to-temp + rename) for crash safety.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { SessionGroup, SessionGroupData, GroupConfig } from "./types";

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "codex-agent");
const GROUPS_FILE = "groups.json";

function resolveConfigDir(configDir?: string): string {
  return configDir ?? DEFAULT_CONFIG_DIR;
}

function groupFilePath(configDir?: string): string {
  return join(resolveConfigDir(configDir), GROUPS_FILE);
}

function toGroup(data: SessionGroupData): SessionGroup {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    paused: data.paused,
    sessionIds: [...data.sessionIds],
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  };
}

function toData(group: SessionGroup): SessionGroupData {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    paused: group.paused,
    sessionIds: [...group.sessionIds],
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

/**
 * Load all groups from persistent storage.
 */
export async function loadGroups(configDir?: string): Promise<GroupConfig> {
  const path = groupFilePath(configDir);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as GroupConfig;
  } catch {
    return { groups: [] };
  }
}

/**
 * Persist groups to storage using atomic write.
 */
export async function saveGroups(config: GroupConfig, configDir?: string): Promise<void> {
  const dir = resolveConfigDir(configDir);
  await mkdir(dir, { recursive: true });
  const path = groupFilePath(configDir);
  const tmpPath = path + ".tmp." + randomUUID().slice(0, 8);
  const json = JSON.stringify(config, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}

/**
 * Create a new group.
 */
export async function addGroup(
  name: string,
  description?: string,
  configDir?: string,
): Promise<SessionGroup> {
  const config = await loadGroups(configDir);
  const now = new Date();
  const group: SessionGroup = {
    id: randomUUID(),
    name,
    description,
    paused: false,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const newConfig: GroupConfig = {
    groups: [...config.groups, toData(group)],
  };
  await saveGroups(newConfig, configDir);
  return group;
}

/**
 * Delete a group by ID.
 */
export async function removeGroup(
  id: string,
  configDir?: string,
): Promise<boolean> {
  const config = await loadGroups(configDir);
  const filtered = config.groups.filter((g) => g.id !== id);
  if (filtered.length === config.groups.length) {
    return false;
  }
  await saveGroups({ groups: filtered }, configDir);
  return true;
}

/**
 * Find a group by ID or name.
 */
export async function findGroup(
  idOrName: string,
  configDir?: string,
): Promise<SessionGroup | null> {
  const config = await loadGroups(configDir);
  const data = config.groups.find((g) => g.id === idOrName || g.name === idOrName);
  return data ? toGroup(data) : null;
}

/**
 * List all groups.
 */
export async function listGroups(configDir?: string): Promise<readonly SessionGroup[]> {
  const config = await loadGroups(configDir);
  return config.groups.map(toGroup);
}

/**
 * Add a session ID to a group.
 */
export async function addSessionToGroup(
  groupId: string,
  sessionId: string,
  configDir?: string,
): Promise<void> {
  const config = await loadGroups(configDir);
  const newGroups = config.groups.map((g) => {
    if (g.id !== groupId) return g;
    if (g.sessionIds.includes(sessionId)) return g;
    return {
      ...g,
      sessionIds: [...g.sessionIds, sessionId],
      updatedAt: new Date().toISOString(),
    };
  });
  await saveGroups({ groups: newGroups }, configDir);
}

/**
 * Remove a session ID from a group.
 */
export async function removeSessionFromGroup(
  groupId: string,
  sessionId: string,
  configDir?: string,
): Promise<void> {
  const config = await loadGroups(configDir);
  const newGroups = config.groups.map((g) => {
    if (g.id !== groupId) return g;
    return {
      ...g,
      sessionIds: g.sessionIds.filter((s) => s !== sessionId),
      updatedAt: new Date().toISOString(),
    };
  });
  await saveGroups({ groups: newGroups }, configDir);
}

export async function pauseGroup(groupId: string, configDir?: string): Promise<boolean> {
  const config = await loadGroups(configDir);
  let found = false;
  const groups = config.groups.map((group) => {
    if (group.id !== groupId) {
      return group;
    }
    found = true;
    return {
      ...group,
      paused: true,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!found) {
    return false;
  }
  await saveGroups({ groups }, configDir);
  return true;
}

export async function resumeGroup(groupId: string, configDir?: string): Promise<boolean> {
  const config = await loadGroups(configDir);
  let found = false;
  const groups = config.groups.map((group) => {
    if (group.id !== groupId) {
      return group;
    }
    found = true;
    return {
      ...group,
      paused: false,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!found) {
    return false;
  }
  await saveGroups({ groups }, configDir);
  return true;
}
