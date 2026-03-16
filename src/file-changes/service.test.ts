import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findSessionsByFile,
  getChangedFiles,
  getSessionFilePatchHistory,
  rebuildFileIndex,
} from "./service";

describe("file change service", () => {
  let codexHome: string;
  let configDir: string;
  const sessionId = "5973b6c0-94b8-487b-a530-2aeb6098ae0e";

  beforeEach(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "codex-agent-file-changes-home-"));
    configDir = await mkdtemp(
      join(tmpdir(), "codex-agent-file-changes-config-"),
    );

    const dayDir = join(codexHome, "sessions", "2026", "02", "20");
    await mkdir(dayDir, { recursive: true });

    const lines = [
      JSON.stringify({
        timestamp: "2026-02-20T01:00:00.000Z",
        type: "session_meta",
        payload: {
          meta: {
            id: sessionId,
            timestamp: "2026-02-20T01:00:00.000Z",
            cwd: "/tmp/project",
            originator: "codex-cli",
            cli_version: "0.1.0",
            source: "cli",
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-20T01:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell",
          call_id: "c1",
          arguments: JSON.stringify({
            command: [
              "bash",
              "-lc",
              [
                "apply_patch <<'PATCH'",
                "*** Begin Patch",
                "*** Update File: src/new.ts",
                "@@",
                "-const value = 1;",
                "+const value = 2;",
                "*** End Patch",
                "PATCH",
              ].join("\n"),
            ],
            workdir: "/tmp/project",
          }),
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-20T01:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "c1",
          output: JSON.stringify({
            output: "Success. Updated the following files:\nM src/new.ts\n",
            metadata: { exit_code: 0 },
          }),
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-20T01:00:03.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          status: "completed",
          call_id: "c2",
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: src/new.ts",
            "@@",
            "-const value = 2;",
            "+const value = 3;",
            "*** End Patch",
          ].join("\n"),
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-20T01:00:04.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandBegin",
          call_id: "c3",
          turn_id: "t1",
          command: ["touch", "src/extra.ts"],
          cwd: "/tmp/project",
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-20T01:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandEnd",
          call_id: "c3",
          turn_id: "t1",
          command: ["touch", "src/extra.ts"],
          cwd: "/tmp/project",
          exit_code: 0,
        },
      }),
    ];
    await writeFile(
      join(dayDir, `rollout-${sessionId}.jsonl`),
      lines.join("\n") + "\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(codexHome, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  it("returns changed files for a session", async () => {
    const summary = await getChangedFiles(sessionId, { codexHome, configDir });
    expect(summary.sessionId).toBe(sessionId);
    expect(summary.totalFiles).toBe(2);
    const target = summary.files.find((file) => file.path === "src/new.ts");
    expect(target?.changeCount).toBe(2);
  });

  it("rebuilds index and finds sessions by file", async () => {
    const stats = await rebuildFileIndex(configDir, codexHome);
    expect(stats.indexedSessions).toBe(1);
    expect(stats.indexedFiles).toBe(2);

    const history = await findSessionsByFile("src/new.ts", { configDir });
    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]?.sessionId).toBe(sessionId);
  });

  it("returns per-file patch history ordered by timestamp", async () => {
    const history = await getSessionFilePatchHistory(sessionId, {
      codexHome,
      configDir,
    });

    expect(history.totalFiles).toBe(2);
    expect(history.totalChanges).toBe(3);

    const target = history.files.find((file) => file.path === "src/new.ts");
    expect(target?.changeCount).toBe(2);
    expect(target?.changes.map((change) => change.timestamp)).toEqual([
      "2026-02-20T01:00:01.000Z",
      "2026-02-20T01:00:03.000Z",
    ]);
    expect(target?.changes.every((change) => change.patch !== undefined)).toBe(
      true,
    );
  });

  it("keeps moved files addressable by both old and new paths in patch history", async () => {
    const movedSessionId = "a1ac1270-122c-4b1b-a8b5-7fda22ce2795";
    const dayDir = join(codexHome, "sessions", "2026", "02", "20");
    const lines = [
      JSON.stringify({
        timestamp: "2026-02-20T02:00:00.000Z",
        type: "session_meta",
        payload: {
          meta: {
            id: movedSessionId,
            timestamp: "2026-02-20T02:00:00.000Z",
            cwd: "/tmp/project",
            originator: "codex-cli",
            cli_version: "0.1.0",
            source: "cli",
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-20T02:00:01.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          status: "completed",
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: src/old-name.ts",
            "*** Move to: src/new-name.ts",
            "@@",
            "-old();",
            "+next();",
            "*** End Patch",
          ].join("\n"),
        },
      }),
    ];
    await writeFile(
      join(dayDir, `rollout-${movedSessionId}.jsonl`),
      lines.join("\n") + "\n",
      "utf-8",
    );

    const history = await getSessionFilePatchHistory(movedSessionId, {
      codexHome,
      configDir,
    });

    expect(history.totalFiles).toBe(2);
    expect(history.totalChanges).toBe(2);
    expect(history.files.map((file) => file.path)).toEqual([
      "src/new-name.ts",
      "src/old-name.ts",
    ]);
    expect(history.files[0]?.operation).toBe("modified");
    expect(history.files[1]?.operation).toBe("deleted");
  });
});
