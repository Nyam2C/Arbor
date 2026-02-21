import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ArborStore } from "../../src/storage/sqlite-store.js";
import { executeGraft } from "../../src/tools/graft.js";
import { executeSeed } from "../../src/tools/seed.js";
import { executeCompound } from "../../src/tools/compound.js";

const TEST_DB = path.resolve("tests/.test-compound.db");

describe("executeCompound", () => {
  let store: ArborStore;
  let tmpDir: string;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = new ArborStore(TEST_DB);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arbor-compound-"));
    store.setMeta("project_root", tmpDir);

    // 트리 구조
    store.upsertNode({
      id: "root",
      level: "branch",
      node_type: "functional_area",
      feature: "Root",
      features: [],
      metadata: {},
      parent_id: null,
      feature_path: "",
    });

    executeGraft(store, {
      branches: [
        { id: "security", nodeType: "functional_area", feature: "Security", parentId: "root" },
        { id: "auth", nodeType: "category", feature: "Authentication", parentId: "security" },
      ],
      edges: [],
    });

    executeSeed(store, {
      nodes: [
        {
          id: "auth-service",
          nodeType: "file",
          feature: "auth service",
          features: ["token validation"],
          parentId: "auth",
        },
      ],
    });
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("교훈 노드를 생성한다", () => {
    const result = executeCompound(store, {
      type: "solution",
      title: "N+1 Query Fix",
      content: "Use eager loading",
      tags: ["performance", "database"],
    });

    expect(result.nodeId).toBe("knowledge:solution:n1-query-fix");

    const node = store.getNode(result.nodeId);
    expect(node).toBeDefined();
    expect(node!.node_type).toBe("solution");
    expect(node!.feature).toBe("N+1 Query Fix");
    expect(node!.features).toEqual(["performance", "database"]);
    expect(node!.metadata.content).toBe("Use eager loading");
  });

  it("docs/solutions/ 파일을 생성한다", () => {
    const result = executeCompound(store, {
      type: "pitfall",
      title: "JWT Trap",
      content: "Expiration issue",
      tags: ["security"],
      severity: "P2",
    });

    expect(result.filePath).not.toBeNull();
    expect(fs.existsSync(result.filePath!)).toBe(true);

    const content = fs.readFileSync(result.filePath!, "utf-8");
    expect(content).toContain("title: JWT Trap");
    expect(content).toContain("severity: P2");
  });

  it("relatedNodeIds로 knowledge edge를 생성한다", () => {
    const result = executeCompound(store, {
      type: "solution",
      title: "Auth Fix",
      content: "Fix auth",
      tags: ["auth"],
      relatedNodeIds: ["auth-service"],
    });

    expect(result.edgesCreated).toBe(1);

    const edge = store.getEdge(result.nodeId, "auth-service", "documents");
    expect(edge).toBeDefined();
    expect(edge!.category).toBe("knowledge");
  });

  it("존재하지 않는 relatedNodeId는 스킵한다", () => {
    const result = executeCompound(store, {
      type: "pattern",
      title: "Some Pattern",
      content: "content",
      tags: [],
      relatedNodeIds: ["nonexistent", "auth-service"],
    });

    expect(result.edgesCreated).toBe(1);
  });

  it("parentBranchId로 브랜치 아래에 배치한다", () => {
    const result = executeCompound(store, {
      type: "pitfall",
      title: "Auth Pitfall",
      content: "content",
      tags: [],
      parentBranchId: "auth",
    });

    const node = store.getNode(result.nodeId);
    expect(node!.parent_id).toBe("auth");
    // unplaced가 아님
    expect(node!.metadata.unplaced).toBeUndefined();
  });

  it("parentBranchId 없으면 unplaced로 생성한다", () => {
    const result = executeCompound(store, {
      type: "solution",
      title: "Orphan Solution",
      content: "content",
      tags: [],
    });

    const node = store.getNode(result.nodeId);
    expect(node!.parent_id).toBeNull();
    expect(node!.metadata.unplaced).toBe(true);
  });
});
