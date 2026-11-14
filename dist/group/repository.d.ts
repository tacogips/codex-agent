/**
 * GroupRepository - Persistent storage for group definitions.
 *
 * Stores groups as JSON at ~/.config/codex-agent/groups.json.
 * Uses atomic write (write-to-temp + rename) for crash safety.
 */
import type { SessionGroup, GroupConfig } from "./types";
/**
 * Load all groups from persistent storage.
 */
export declare function loadGroups(configDir?: string): Promise<GroupConfig>;
/**
 * Persist groups to storage using atomic write.
 */
export declare function saveGroups(config: GroupConfig, configDir?: string): Promise<void>;
/**
 * Create a new group.
 */
export declare function addGroup(name: string, description?: string, configDir?: string): Promise<SessionGroup>;
/**
 * Delete a group by ID.
 */
export declare function removeGroup(id: string, configDir?: string): Promise<boolean>;
/**
 * Find a group by ID or name.
 */
export declare function findGroup(idOrName: string, configDir?: string): Promise<SessionGroup | null>;
/**
 * List all groups.
 */
export declare function listGroups(configDir?: string): Promise<readonly SessionGroup[]>;
/**
 * Add a session ID to a group.
 */
export declare function addSessionToGroup(groupId: string, sessionId: string, configDir?: string): Promise<void>;
/**
 * Remove a session ID from a group.
 */
export declare function removeSessionFromGroup(groupId: string, sessionId: string, configDir?: string): Promise<void>;
export declare function pauseGroup(groupId: string, configDir?: string): Promise<boolean>;
export declare function resumeGroup(groupId: string, configDir?: string): Promise<boolean>;
//# sourceMappingURL=repository.d.ts.map