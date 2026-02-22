# Phase 4: Daemon Server & App-Server Integration Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-codex-session-management.md#4.5, #4.6, #5.2, #6
**Created**: 2026-02-20
**Last Updated**: 2026-02-20

---

## Design Document Reference

**Source**: design-docs/specs/design-codex-session-management.md

### Summary
Implement the Phase 4 control plane: production-ready HTTP daemon operation and Codex app-server integration path, while preserving existing CLI subprocess behavior as fallback.

### Scope
**Included**: daemon lifecycle hardening, server runtime integration, app-server transport adapter, CLI integration for daemon/server workflows
**Excluded**: UI dashboard, distributed orchestration, non-Codex protocol adapters

---

## Modules

### 1. Daemon Lifecycle

#### src/daemon/types.ts
**Status**: DONE

```typescript
export interface DaemonInfo {
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
  readonly mode: "http" | "app-server";
}

export interface DaemonConfig {
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly token?: string | undefined;
  readonly codexHome?: string | undefined;
  readonly configDir?: string | undefined;
  readonly mode?: "http" | "app-server" | undefined;
}

export type DaemonStatus = "running" | "stopped" | "stale";

export interface DaemonStatusResult {
  readonly status: DaemonStatus;
  readonly info?: DaemonInfo | undefined;
}
```

**Checklist**:
- [x] Extend daemon config/type contracts for runtime mode
- [x] Preserve backward compatibility with current daemon status responses
- [x] Add tests for mode-aware daemon metadata

#### src/daemon/manager.ts
**Status**: DONE

```typescript
import type { DaemonConfig, DaemonInfo, DaemonStatusResult } from "./types";

export declare function startDaemon(config?: DaemonConfig): Promise<DaemonInfo>;
export declare function stopDaemon(configDir?: string): Promise<boolean>;
export declare function getDaemonStatus(configDir?: string): Promise<DaemonStatusResult>;
```

**Checklist**:
- [x] Add mode-aware daemon startup path
- [x] Add startup readiness probe strategy per mode
- [x] Add stale PID recovery and atomic PID write verification
- [x] Add integration tests for start/stop/status flows

### 2. HTTP Server Runtime

#### src/server/types.ts
**Status**: DONE

```typescript
export interface ServerConfig {
  readonly port: number;
  readonly hostname: string;
  readonly token?: string | undefined;
  readonly codexHome: string;
  readonly configDir: string;
  readonly transport: "local-cli" | "app-server";
  readonly appServerUrl?: string | undefined;
}

export interface ServerHandle {
  readonly port: number;
  readonly hostname: string;
  stop(): void;
}

export declare function resolveServerConfig(
  overrides?: Partial<ServerConfig>,
): ServerConfig;
```

**Checklist**:
- [x] Add explicit transport selection to server config
- [x] Validate app-server URL requirements for app-server transport
- [x] Add config parsing tests for transport-specific validation

#### src/server/server.ts
**Status**: DONE

```typescript
import type { ServerConfig, ServerHandle } from "./types";

export declare function startServer(config: ServerConfig): ServerHandle;
```

**Checklist**:
- [x] Route runtime behavior by selected transport
- [x] Keep auth middleware enforcement consistent across transports
- [x] Add endpoint integration tests for status/health/sessions routes

### 3. App-Server Transport Adapter

#### src/server/app-server-client.ts
**Status**: DONE

```typescript
export interface AppServerClientConfig {
  readonly url: string;
  readonly reconnectMs?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

export interface AppServerSessionEvent {
  readonly type: string;
  readonly sessionId?: string | undefined;
  readonly payload: unknown;
}

export interface AppServerClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  request<TResponse>(method: string, params?: unknown): Promise<TResponse>;
  subscribe(onEvent: (event: AppServerSessionEvent) => void): () => void;
}

export declare function createAppServerClient(
  config: AppServerClientConfig,
): AppServerClient;
```

**Checklist**:
- [x] Implement request/response framing for Codex app-server protocol
- [x] Implement reconnect and subscription lifecycle management
- [x] Add contract tests with mocked WebSocket server

### 4. CLI Integration

#### src/cli/index.ts
**Status**: DONE

```typescript
import type { ServerConfig } from "../server/types";
import type { DaemonConfig } from "../daemon/types";

export interface ServerStartArgs {
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly token?: string | undefined;
  readonly transport?: "local-cli" | "app-server" | undefined;
  readonly appServerUrl?: string | undefined;
}

export interface DaemonStartArgs extends DaemonConfig {}

export declare function runCli(argv?: readonly string[]): Promise<void>;
export declare function parseServerStartArgs(
  args: readonly string[],
): ServerStartArgs;
```

**Checklist**:
- [x] Add `--transport` and `--app-server-url` server options
- [x] Add daemon mode option parity with server options
- [x] Add CLI tests for argument parsing and command execution paths

---

## Task Breakdown

### TASK-001: Server/Daemon Type Contracts
**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/server/types.ts`, `src/daemon/types.ts`
**Dependencies**: None

**Completion Criteria**:
- [x] Transport and daemon mode types defined
- [x] Type checks pass
- [x] Type-level and unit tests updated

### TASK-002: Daemon Lifecycle Hardening
**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/daemon/manager.ts`, `src/daemon/manager.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:
- [x] Mode-aware daemon startup works
- [x] PID lifecycle handling is robust
- [x] Daemon manager tests pass

### TASK-003: App-Server Transport Adapter
**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/app-server-client.ts`, `src/server/websocket.ts`, `src/server/server.ts`
**Dependencies**: TASK-001

**Completion Criteria**:
- [x] App-server client implemented
- [x] Server can operate with app-server transport
- [x] Transport contract tests pass

### TASK-004: CLI Transport/Daemon Command Integration
**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/index.ts`, `src/server/server.test.ts`
**Dependencies**: TASK-002, TASK-003

**Completion Criteria**:
- [x] New server/daemon options wired to runtime config
- [x] CLI command paths validated by tests
- [x] End-to-end server start checks pass

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Daemon lifecycle types | `src/daemon/types.ts` | DONE | `src/daemon/manager.test.ts` |
| Daemon lifecycle manager | `src/daemon/manager.ts` | DONE | `src/daemon/manager.test.ts` |
| Server transport config | `src/server/types.ts` | DONE | `src/server/server.test.ts` |
| HTTP server runtime | `src/server/server.ts` | DONE | `src/server/server.test.ts` |
| App-server client | `src/server/app-server-client.ts` | DONE | `src/server/app-server-client.test.ts` |
| CLI integration | `src/cli/index.ts` | DONE | `src/cli/index.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Phase 4 daemon/server | `phase3-sqlite-group-queue:TASK-004` | Available |
| Daemon lifecycle hardening | TASK-001 | BLOCKED |
| App-server adapter | TASK-001 | BLOCKED |
| CLI transport integration | TASK-002, TASK-003 | BLOCKED |

## Completion Criteria

- [x] All modules implemented
- [x] All tests passing
- [x] Type checking passes
- [x] Daemon start/stop/status validated for both transport modes
- [x] App-server transport successfully handles session/event flows

## Progress Log

### Session: 2026-02-20
**Tasks Completed**: Plan created
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Phase 4 plan prepared as continuation after Phase 3 completion.

### Session: 2026-02-20 (Implementation)
**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added transport-aware server/daemon config, app-server WebSocket client, CLI transport/mode flags, and tests. Verified with `bun run typecheck` and `bun run test`.

## Related Plans

- **Previous**: `impl-plans/active/phase3-sqlite-group-queue.md`
- **Depends On**: `impl-plans/active/phase3-sqlite-group-queue.md`
