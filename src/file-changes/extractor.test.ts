import { describe, expect, it } from "vitest";
import type { RolloutLine } from "../types/rollout";
import { extractChangedFiles } from "./extractor";

describe("extractChangedFiles", () => {
  it("extracts changed files from exec command events", () => {
    const lines: readonly RolloutLine[] = [
      {
        timestamp: "2026-02-20T00:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandBegin",
          call_id: "c1",
          turn_id: "t1",
          command: ["touch", "src/new-file.ts"],
          cwd: "/tmp/repo",
        },
      },
      {
        timestamp: "2026-02-20T00:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandEnd",
          call_id: "c1",
          turn_id: "t1",
          command: ["sed", "-i", "s/a/b/", "src/new-file.ts"],
          cwd: "/tmp/repo",
          exit_code: 0,
        },
      },
      {
        timestamp: "2026-02-20T00:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "ExecCommandBegin",
          call_id: "c2",
          turn_id: "t1",
          command: ["rm", "src/old-file.ts"],
          cwd: "/tmp/repo",
        },
      },
    ];

    const files = extractChangedFiles(lines);
    expect(files).toHaveLength(2);
    const created = files.find((f) => f.path === "src/new-file.ts");
    const deleted = files.find((f) => f.path === "src/old-file.ts");

    expect(created).toMatchObject({
      operation: "modified",
      changeCount: 2,
    });
    expect(deleted).toMatchObject({
      operation: "deleted",
      changeCount: 1,
    });
  });
});

