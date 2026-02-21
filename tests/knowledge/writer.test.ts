import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeSolutionFile, toKebabCase } from "../../src/knowledge/writer.js";

describe("toKebabCase", () => {
  it("영어 문자열을 kebab-case로 변환한다", () => {
    expect(toKebabCase("JWT Expiration Trap")).toBe("jwt-expiration-trap");
  });

  it("한국어를 보존한다", () => {
    expect(toKebabCase("N+1 해결법")).toBe("n1-해결법");
  });

  it("특수문자를 제거한다", () => {
    expect(toKebabCase("Hello! World@#$")).toBe("hello-world");
  });
});

describe("writeSolutionFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arbor-writer-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("docs/solutions/에 마크다운 파일을 생성한다", () => {
    const filePath = writeSolutionFile(tmpDir, {
      title: "JWT Expiration Trap",
      type: "pitfall",
      content: "## 문제\n\nJWT 만료 이슈",
      tags: ["security", "jwt"],
      severity: "P2",
      date: "2025-01-15",
    });

    expect(filePath).toContain("2025-01-15-jwt-expiration-trap.md");
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("title: JWT Expiration Trap");
    expect(content).toContain("severity: P2");
    expect(content).toContain("## 문제");
  });

  it("디렉토리가 없으면 자동 생성한다", () => {
    // deep/nested는 존재하지 않으므로 mkdirSync({ recursive: true }) 동작 확인
    // writeSolutionFile은 projectRoot/docs/solutions/를 생성
    const filePath = writeSolutionFile(tmpDir, {
      title: "Test",
      type: "solution",
      content: "content",
      tags: [],
    });

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("severity가 없으면 null로 설정한다", () => {
    const filePath = writeSolutionFile(tmpDir, {
      title: "No Severity",
      type: "pattern",
      content: "content",
      tags: ["test"],
    });

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("severity: null");
  });
});
