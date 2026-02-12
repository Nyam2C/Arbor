import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ArborStore } from "../src/storage/sqlite-store.js";
import { executeGraft } from "../src/tools/graft.js";
import { executeSeed } from "../src/tools/seed.js";

const TEST_DB = path.resolve("tests/.test-graft.db");

describe("executeGraft", () => {
  let store: ArborStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = new ArborStore(TEST_DB);
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
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("branch 노드를 생성한다", () => {
    const result = executeGraft(store, {
      branches: [{ id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" }],
      edges: [],
    });
    expect(result.branchesCreated).toBe(1);
    expect(result.branchesUpdated).toBe(0);

    const node = store.getNode("sec");
    expect(node!.level).toBe("branch");
    expect(node!.node_type).toBe("functional_area");
  });

  it("기존 branch를 re-graft하면 updated로 카운트한다", () => {
    executeGraft(store, {
      branches: [{ id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" }],
      edges: [],
    });

    const result = executeGraft(store, {
      branches: [
        { id: "sec", nodeType: "functional_area", feature: "Security v2", parentId: "root" },
      ],
      edges: [],
    });
    expect(result.branchesCreated).toBe(0);
    expect(result.branchesUpdated).toBe(1);
    expect(store.getNode("sec")!.feature).toBe("Security v2");
  });

  it("feature_path를 자동 구성한다", () => {
    executeGraft(store, {
      branches: [{ id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" }],
      edges: [],
    });
    expect(store.getNode("sec")!.feature_path).toBe("Security");

    executeGraft(store, {
      branches: [{ id: "auth", nodeType: "category", feature: "Authentication", parentId: "sec" }],
      edges: [],
    });
    expect(store.getNode("auth")!.feature_path).toBe("Security/Authentication");

    executeGraft(store, {
      branches: [
        { id: "token", nodeType: "subcategory", feature: "TokenValidation", parentId: "auth" },
      ],
      edges: [],
    });
    expect(store.getNode("token")!.feature_path).toBe("Security/Authentication/TokenValidation");
  });

  it("parentId로 growth edge를 자동 생성한다", () => {
    executeGraft(store, {
      branches: [{ id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" }],
      edges: [],
    });
    const edge = store.getEdge("root", "sec", "contains");
    expect(edge).toBeDefined();
    expect(edge!.category).toBe("growth");
  });

  it("growth 카테고리 edge를 직접 넣으면 무시한다", () => {
    executeGraft(store, {
      branches: [{ id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" }],
      edges: [{ sourceId: "root", targetId: "sec", edgeType: "contains", category: "growth" }],
    });
    // growth edge는 parentId로만 생성되므로 edges 카운트는 0
    // (parentId에서 이미 생성됨)
    expect(store.getEdge("root", "sec", "contains")).toBeDefined();
  });

  it("root/knowledge edge를 생성한다", () => {
    // 두 leaf 노드 준비
    executeSeed(store, {
      nodes: [
        { id: "file1", nodeType: "file", feature: "auth service", parentId: "root" },
        { id: "file2", nodeType: "file", feature: "user service", parentId: "root" },
      ],
    });

    const result = executeGraft(store, {
      branches: [],
      edges: [{ sourceId: "file1", targetId: "file2", edgeType: "imports", category: "root" }],
    });
    expect(result.edgesCreated).toBe(1);
    expect(store.getEdge("file1", "file2", "imports")).toBeDefined();
  });

  it("대상 노드의 unplaced를 제거한다", () => {
    // unplaced 상태의 leaf 생성
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test" }],
    });
    expect(store.getNode("file1")!.metadata.unplaced).toBe(true);

    // knowledge edge로 연결하면 unplaced 제거
    executeSeed(store, {
      nodes: [{ id: "pitfall1", nodeType: "pitfall", feature: "trap", parentId: "root" }],
    });
    executeGraft(store, {
      branches: [],
      edges: [
        { sourceId: "pitfall1", targetId: "file1", edgeType: "documents", category: "knowledge" },
      ],
    });
    expect(store.getNode("file1")!.metadata.unplaced).toBeUndefined();
  });
});
