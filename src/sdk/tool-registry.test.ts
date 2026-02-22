import { describe, expect, it } from "vitest";
import { tool, ToolRegistry } from "./tool-registry";

describe("tool + ToolRegistry", () => {
  it("registers and runs a tool", async () => {
    const registry = new ToolRegistry();
    const sumTool = tool<{ a: number; b: number }, number>({
      name: "sum",
      run: ({ a, b }) => a + b,
    });
    registry.register(sumTool);

    const output = await registry.run<{ a: number; b: number }, number>("sum", {
      a: 2,
      b: 3,
    });
    expect(output).toBe(5);
    expect(registry.list()).toEqual(["sum"]);
  });

  it("throws for unknown tool", async () => {
    const registry = new ToolRegistry();
    await expect(registry.run("missing", {})).rejects.toThrow("tool not found");
  });
});

