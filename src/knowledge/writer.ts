import fs from "node:fs";
import path from "node:path";
import { stringify as yamlStringify } from "yaml";

// ---------------------------------------------------------------------------
// docs/solutions/ 마크다운 파일 생성
// ---------------------------------------------------------------------------

export interface WriteSolutionInput {
  title: string;
  type: "solution" | "pattern" | "pitfall";
  content: string;
  tags: string[];
  severity?: "P1" | "P2" | "P3";
  date?: string;
}

/**
 * docs/solutions/ 에 마크다운 파일을 생성한다.
 * 파일명: YYYY-MM-DD-kebab-title.md
 * @returns 생성된 파일의 절대 경로
 */
export function writeSolutionFile(projectRoot: string, input: WriteSolutionInput): string {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const kebabTitle = toKebabCase(input.title);
  const fileName = `${date}-${kebabTitle}.md`;

  const dir = path.join(projectRoot, "docs", "solutions");
  fs.mkdirSync(dir, { recursive: true });

  const frontmatter = yamlStringify({
    title: input.title,
    date,
    tags: input.tags,
    category:
      input.type === "solution" ? "solutions" : input.type === "pattern" ? "patterns" : "pitfalls",
    severity: input.severity ?? null,
    status: "resolved",
  }).trim();

  const content = `---\n${frontmatter}\n---\n\n${input.content}\n`;

  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content, "utf-8");

  return filePath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
