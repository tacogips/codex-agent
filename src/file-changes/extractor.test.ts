import { describe, expect, it } from "vitest";
import type { RolloutLine } from "../types/rollout";
import { extractChangedFiles, extractFileChangeDetails } from "./extractor";

describe("extractFileChangeDetails", () => {
  it("extracts per-file patch entries from successful shell apply_patch calls", () => {
    const lines: readonly RolloutLine[] = [
      {
        timestamp: "2026-03-15T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell",
          call_id: "call-1",
          arguments: JSON.stringify({
            command: [
              "bash",
              "-lc",
              [
                "apply_patch <<'PATCH'",
                "*** Begin Patch",
                "*** Update File: src/app.ts",
                "@@",
                "-old();",
                "+next();",
                "*** Add File: src/new.ts",
                "+export const created = true;",
                "*** End Patch",
                "PATCH",
              ].join("\n"),
            ],
            workdir: "/tmp/project",
          }),
        },
      },
      {
        timestamp: "2026-03-15T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({
            output:
              "Success. Updated the following files:\nM src/app.ts\nA src/new.ts\n",
            metadata: { exit_code: 0 },
          }),
        },
      },
    ];

    const details = extractFileChangeDetails(lines);
    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({
      path: "src/app.ts",
      operation: "modified",
      source: "apply_patch",
    });
    expect(details[0]?.patch).toContain("*** Update File: src/app.ts");
    expect(details[1]).toMatchObject({
      path: "src/new.ts",
      operation: "created",
      source: "apply_patch",
    });

    const summary = extractChangedFiles(lines);
    expect(summary).toEqual([
      {
        path: "src/app.ts",
        operation: "modified",
        changeCount: 1,
        lastModified: "2026-03-15T00:00:01.000Z",
      },
      {
        path: "src/new.ts",
        operation: "created",
        changeCount: 1,
        lastModified: "2026-03-15T00:00:01.000Z",
      },
    ]);
  });

  it("ignores read-only and failed shell commands", () => {
    const lines: readonly RolloutLine[] = [
      {
        timestamp: "2026-03-15T00:01:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "read-1",
          arguments: JSON.stringify({
            cmd: "sed -n '1,40p' README.md",
          }),
        },
      },
      {
        timestamp: "2026-03-15T00:01:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "read-1",
          output: JSON.stringify({
            output: "README contents",
            metadata: { exit_code: 0 },
          }),
        },
      },
      {
        timestamp: "2026-03-15T00:01:02.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandBegin",
          call_id: "rm-1",
          turn_id: "turn-1",
          command: ["rm", "src/old.ts"],
          cwd: "/tmp/project",
        },
      },
      {
        timestamp: "2026-03-15T00:01:03.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandEnd",
          call_id: "rm-1",
          turn_id: "turn-1",
          command: ["rm", "src/old.ts"],
          cwd: "/tmp/project",
          exit_code: 1,
        },
      },
      {
        timestamp: "2026-03-15T00:01:04.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandBegin",
          call_id: "touch-1",
          turn_id: "turn-1",
          command: ["touch", "src/new.ts"],
          cwd: "/tmp/project",
        },
      },
      {
        timestamp: "2026-03-15T00:01:05.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandEnd",
          call_id: "touch-1",
          turn_id: "turn-1",
          command: ["touch", "src/new.ts"],
          cwd: "/tmp/project",
          exit_code: 0,
        },
      },
    ];

    expect(extractFileChangeDetails(lines)).toEqual([
      {
        path: "src/new.ts",
        timestamp: "2026-03-15T00:01:04.000Z",
        operation: "created",
        source: "local_shell",
        command: "touch src/new.ts",
      },
    ]);
  });

  it("records only redirected output targets for write commands", () => {
    const lines: readonly RolloutLine[] = [
      {
        timestamp: "2026-03-15T00:02:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "write-1",
          arguments: JSON.stringify({
            cmd: "echo hello > src/generated.txt",
          }),
        },
      },
      {
        timestamp: "2026-03-15T00:02:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "write-1",
          output: JSON.stringify({
            output: "",
            metadata: { exit_code: 0 },
          }),
        },
      },
    ];

    expect(extractChangedFiles(lines)).toEqual([
      {
        path: "src/generated.txt",
        operation: "created",
        changeCount: 1,
        lastModified: "2026-03-15T00:02:00.000Z",
      },
    ]);
  });

  it("treats append redirections as file modifications", () => {
    const lines: readonly RolloutLine[] = [
      {
        timestamp: "2026-03-15T00:02:10.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "append-1",
          arguments: JSON.stringify({
            cmd: "printf '%s\\n' tail >> src/generated.txt",
          }),
        },
      },
      {
        timestamp: "2026-03-15T00:02:11.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "append-1",
          output: JSON.stringify({
            output: "",
            metadata: { exit_code: 0 },
          }),
        },
      },
    ];

    expect(extractChangedFiles(lines)).toEqual([
      {
        path: "src/generated.txt",
        operation: "modified",
        changeCount: 1,
        lastModified: "2026-03-15T00:02:10.000Z",
      },
    ]);
  });

  it("indexes apply_patch moves under both the old and new path", () => {
    const lines: readonly RolloutLine[] = [
      {
        timestamp: "2026-03-15T00:03:00.000Z",
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
      },
    ];

    expect(extractChangedFiles(lines)).toEqual([
      {
        path: "src/new-name.ts",
        operation: "modified",
        changeCount: 1,
        lastModified: "2026-03-15T00:03:00.000Z",
      },
      {
        path: "src/old-name.ts",
        operation: "deleted",
        changeCount: 1,
        lastModified: "2026-03-15T00:03:00.000Z",
      },
    ]);
  });
});
