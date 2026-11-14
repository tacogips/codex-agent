import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findSessionsByFile, getChangedFiles, rebuildFileIndex } from "./service";

describe("file change service", () => {
  let codexHome: string;
  let configDir: string;
  const sessionId = "5973b6c0-94b8-487b-a530-2aeb6098ae0e";

  beforeEach(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "codex-agent-file-changes-home-"));
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-file-changes-config-"));

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
        type: "event_msg",
        payload: {
          type: "ExecCommandBegin",
          call_id: "c1",
          turn_id: "t1",
          command: ["touch", "src/new.ts"],
          cwd: "/tmp/project",
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
    expect(summary.totalFiles).toBe(1);
    expect(summary.files[0]?.path).toBe("src/new.ts");
  });

  it("rebuilds index and finds sessions by file", async () => {
    const stats = await rebuildFileIndex(configDir, codexHome);
    expect(stats.indexedSessions).toBe(1);
    expect(stats.indexedFiles).toBe(1);

    const history = await findSessionsByFile("src/new.ts", { configDir });
    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]?.sessionId).toBe(sessionId);
  });
});

