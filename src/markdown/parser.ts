import type { MarkdownTask, ParsedMarkdown, ParsedMarkdownSection } from "./types";

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;

export function parseMarkdown(content: string): ParsedMarkdown {
  const lines = content.split(/\r?\n/);
  const sections: ParsedMarkdownSection[] = [];

  let currentHeading = "";
  let currentContent: string[] = [];

  const flush = (): void => {
    if (currentContent.length === 0 && currentHeading.length === 0) {
      return;
    }
    sections.push({
      heading: currentHeading,
      content: currentContent.join("\n").trim(),
    });
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match !== null) {
      flush();
      currentHeading = match[2]?.trim() ?? "";
      currentContent = [];
      continue;
    }
    currentContent.push(line);
  }

  flush();

  if (sections.length === 0) {
    return { sections: [{ heading: "", content: content.trim() }] };
  }
  return { sections };
}

export function extractMarkdownTasks(content: string): readonly MarkdownTask[] {
  const parsed = parseMarkdown(content);
  const tasks: MarkdownTask[] = [];
  for (const section of parsed.sections) {
    const lines = section.content.split(/\r?\n/);
    for (const line of lines) {
      const match = TASK_RE.exec(line);
      if (match === null) {
        continue;
      }
      tasks.push({
        sectionHeading: section.heading,
        checked: match[1]?.toLowerCase() === "x",
        text: match[2]?.trim() ?? "",
      });
    }
  }
  return tasks;
}

