import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createToken,
  listTokens,
  revokeToken,
  rotateToken,
  verifyToken,
  parsePermissionList,
} from "./token-manager";

describe("TokenManager", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-token-test-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates and verifies a token", async () => {
    const token = await createToken(
      {
        name: "test token",
        permissions: ["session:read"],
      },
      configDir,
    );

    const verified = await verifyToken(token, configDir);
    expect(verified.ok).toBe(true);
    expect(verified.metadata?.permissions).toEqual(["session:read"]);
  });

  it("lists metadata without exposing token secret", async () => {
    await createToken(
      {
        name: "listable",
        permissions: ["group:*"],
      },
      configDir,
    );

    const tokens = await listTokens(configDir);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.name).toBe("listable");
    expect(tokens[0]!.permissions).toEqual(["group:*"]);
  });

  it("revokes token and blocks verification", async () => {
    const token = await createToken(
      {
        name: "revokable",
        permissions: ["queue:*"],
      },
      configDir,
    );
    const id = token.split(".")[0]!;

    const revoked = await revokeToken(id, configDir);
    expect(revoked).toBe(true);
    const verified = await verifyToken(token, configDir);
    expect(verified.ok).toBe(false);
  });

  it("rotates token and invalidates previous token secret", async () => {
    const original = await createToken(
      {
        name: "rotatable",
        permissions: ["session:read"],
      },
      configDir,
    );
    const id = original.split(".")[0]!;
    const rotated = await rotateToken(id, configDir);

    expect((await verifyToken(original, configDir)).ok).toBe(false);
    expect((await verifyToken(rotated, configDir)).ok).toBe(true);
  });

  it("parses permission CSV", () => {
    expect(parsePermissionList("session:read, group:*, nope")).toEqual([
      "session:read",
      "group:*",
    ]);
  });
});

