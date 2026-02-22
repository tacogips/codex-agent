import { describe, expect, it } from "vitest";
import { extractMarkdownTasks, parseMarkdown } from "./parser";

describe("parseMarkdown", () => {
  it("splits markdown into heading-based sections", () => {
    const parsed = parseMarkdown(`# Plan
line 1

## Tasks
- [ ] one`);

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]!.heading).toBe("Plan");
    expect(parsed.sections[0]!.content).toContain("line 1");
    expect(parsed.sections[1]!.heading).toBe("Tasks");
  });

  it("returns one section for markdown without headings", () => {
    const parsed = parseMarkdown("plain text body");
    expect(parsed.sections).toEqual([{ heading: "", content: "plain text body" }]);
  });
});

describe("extractMarkdownTasks", () => {
  it("extracts checkbox tasks with checked state", () => {
    const tasks = extractMarkdownTasks(`## Todo
- [ ] first
- [x] second`);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      sectionHeading: "Todo",
      text: "first",
      checked: false,
    });
    expect(tasks[1]?.checked).toBe(true);
  });
});

