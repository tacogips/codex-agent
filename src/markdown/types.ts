export interface ParsedMarkdownSection {
  readonly heading: string;
  readonly content: string;
}

export interface ParsedMarkdown {
  readonly sections: readonly ParsedMarkdownSection[];
}

export interface MarkdownTask {
  readonly sectionHeading: string;
  readonly text: string;
  readonly checked: boolean;
}

