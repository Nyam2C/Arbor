import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ArborStore } from "../../src/storage/sqlite-store.js";
import { executeSeed } from "../../src/tools/seed.js";

const TEST_DB = path.resolve("tests/.test-seed.db");

describe("executeSeed", () => {
  let store: ArborStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = new ArborStore(TEST_DB);
    // Root 노드
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
    // 테스트용 branch
    store.upsertNode({
      id: "branch-a",
      level: "branch",
      node_type: "category",
      feature: "BranchA",
      features: [],
      metadata: {},
      parent_id: "root",
      feature_path: "BranchA",
    });
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("새 leaf 노드를 생성한다", () => {
    const result = executeSeed(store, {
      nodes: [
        { id: "file1", nodeType: "file", feature: "auth service", features: ["validate token"] },
      ],
    });
    expect(result).toEqual({ created: 1, updated: 0 });

    const node = store.getNode("file1");
    expect(node).toBeDefined();
    expect(node!.level).toBe("leaf");
    expect(node!.node_type).toBe("file");
  });

  it("parentId 없이 seed하면 unplaced=true", () => {
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test" }],
    });
    const node = store.getNode("file1");
    expect(node!.metadata.unplaced).toBe(true);
  });

  it("parentId 포함 seed하면 unplaced 제거", () => {
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test", parentId: "branch-a" }],
    });
    const node = store.getNode("file1");
    expect(node!.metadata.unplaced).toBeUndefined();
    expect(node!.parent_id).toBe("branch-a");
  });

  it("seed 시 stale을 제거한다", () => {
    executeSeed(store, {
      nodes: [
        {
          id: "file1",
          nodeType: "file",
          feature: "test",
          metadata: { stale: true, custom: "keep" },
        },
      ],
    });
    const node = store.getNode("file1");
    expect(node!.metadata.stale).toBeUndefined();
    expect(node!.metadata.custom).toBe("keep");
  });

  it("UPSERT 시 created_at을 보존한다", () => {
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "v1" }],
    });
    const first = store.getNode("file1");
    const originalCreatedAt = first!.created_at;

    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "v2" }],
    });
    const second = store.getNode("file1");
    expect(second!.feature).toBe("v2");
    expect(second!.created_at).toBe(originalCreatedAt);
  });

  it("UPSERT 시 updated를 카운트한다", () => {
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "v1" }],
    });
    const result = executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "v2" }],
    });
    expect(result).toEqual({ created: 0, updated: 1 });
  });

  it("parentId 변경 시 growth edge를 동기화한다", () => {
    // branch-b 추가
    store.upsertNode({
      id: "branch-b",
      level: "branch",
      node_type: "category",
      feature: "BranchB",
      features: [],
      metadata: {},
      parent_id: "root",
      feature_path: "BranchB",
    });

    // 처음에 branch-a 아래에 배치
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test", parentId: "branch-a" }],
    });
    expect(store.getEdge("branch-a", "file1", "contains")).toBeDefined();

    // branch-b로 이동
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test", parentId: "branch-b" }],
    });
    expect(store.getEdge("branch-a", "file1", "contains")).toBeUndefined();
    expect(store.getEdge("branch-b", "file1", "contains")).toBeDefined();
  });

  it("parentId 제거 시 기존 growth edge를 정리한다", () => {
    // branch-a 아래에 배치
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test", parentId: "branch-a" }],
    });
    expect(store.getEdge("branch-a", "file1", "contains")).toBeDefined();
    expect(store.getNode("file1")!.metadata.unplaced).toBeUndefined();

    // parentId 없이 re-seed → growth edge 정리 + unplaced 설정
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test" }],
    });
    expect(store.getEdge("branch-a", "file1", "contains")).toBeUndefined();
    expect(store.getNode("file1")!.parent_id).toBeNull();
    expect(store.getNode("file1")!.metadata.unplaced).toBe(true);
  });

  it("교훈 노드(pitfall)를 저장한다", () => {
    executeSeed(store, {
      nodes: [
        {
          id: "pitfall1",
          nodeType: "pitfall",
          feature: "JWT expiration trap",
          metadata: { severity: "P1", tags: ["jwt", "auth"] },
        },
      ],
    });
    const node = store.getNode("pitfall1");
    expect(node!.node_type).toBe("pitfall");
    expect(node!.metadata.severity).toBe("P1");
  });
});
