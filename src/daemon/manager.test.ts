import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDaemonStatus, stopDaemon } from "./manager";

describe("DaemonManager", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-daemon-test-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  describe("getDaemonStatus", () => {
    it("returns stopped when no PID file exists", async () => {
      const result = await getDaemonStatus(configDir);
      expect(result.status).toBe("stopped");
      expect(result.info).toBeUndefined();
    });

    it("returns stale when PID file has dead process", async () => {
      const info = {
        pid: 999999,
        port: 3100,
        startedAt: new Date().toISOString(),
        mode: "http",
      };
      await writeFile(join(configDir, "daemon.pid"), JSON.stringify(info));

      const result = await getDaemonStatus(configDir);
      expect(result.status).toBe("stale");
      expect(result.info).toBeDefined();
      expect(result.info!.pid).toBe(999999);
    });

    it("returns running when PID file has live process", async () => {
      // Use the current process PID which is guaranteed to be alive
      const info = {
        pid: process.pid,
        port: 3100,
        startedAt: new Date().toISOString(),
        mode: "http",
      };
      await writeFile(join(configDir, "daemon.pid"), JSON.stringify(info));

      const result = await getDaemonStatus(configDir);
      expect(result.status).toBe("running");
      expect(result.info!.pid).toBe(process.pid);
      expect(result.info!.mode).toBe("http");
    });

    it("defaults missing mode to http for backward compatibility", async () => {
      const old = {
        pid: process.pid,
        port: 3100,
        startedAt: new Date().toISOString(),
      };
      await writeFile(join(configDir, "daemon.pid"), JSON.stringify(old));
      const result = await getDaemonStatus(configDir);
      expect(result.status).toBe("running");
      expect(result.info!.mode).toBe("http");
    });

    it("returns stopped for malformed PID file", async () => {
      await writeFile(join(configDir, "daemon.pid"), "not json");
      const result = await getDaemonStatus(configDir);
      expect(result.status).toBe("stopped");
    });

    it("returns stopped for PID file with missing fields", async () => {
      await writeFile(join(configDir, "daemon.pid"), JSON.stringify({ pid: 123 }));
      const result = await getDaemonStatus(configDir);
      expect(result.status).toBe("stopped");
    });
  });

  describe("stopDaemon", () => {
    it("returns false when no PID file exists", async () => {
      const stopped = await stopDaemon(configDir);
      expect(stopped).toBe(false);
    });

    it("removes PID file on stop", async () => {
      const info = {
        pid: 999999,
        port: 3100,
        startedAt: new Date().toISOString(),
        mode: "http",
      };
      await writeFile(join(configDir, "daemon.pid"), JSON.stringify(info));

      const stopped = await stopDaemon(configDir);
      expect(stopped).toBe(true);

      // PID file should be removed
      const status = await getDaemonStatus(configDir);
      expect(status.status).toBe("stopped");
    });

    it("handles already-dead process gracefully", async () => {
      const info = {
        pid: 999999,
        port: 3100,
        startedAt: new Date().toISOString(),
        mode: "http",
      };
      await writeFile(join(configDir, "daemon.pid"), JSON.stringify(info));

      const stopped = await stopDaemon(configDir);
      expect(stopped).toBe(true);
    });
  });
});
