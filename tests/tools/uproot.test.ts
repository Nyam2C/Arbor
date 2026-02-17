import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ArborStore } from "../../src/storage/sqlite-store.js";
import { executeUproot } from "../../src/tools/uproot.js";
import { executeSeed } from "../../src/tools/seed.js";
import { executeGraft } from "../../src/tools/graft.js";

const TEST_DB = path.resolve("tests/.test-uproot.db");

describe("executeUproot", () => {
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

  it("노드를 삭제한다", () => {
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test", parentId: "root" }],
    });
    const result = executeUproot(store, { nodeIds: ["file1"], edgeKeys: [] });
    expect(result.nodesRemoved).toBe(1);
    expect(store.getNode("file1")).toBeUndefined();
  });

  it("Root 노드는 삭제 거부한다", () => {
    const result = executeUproot(store, { nodeIds: ["root"], edgeKeys: [] });
    expect(result.nodesRemoved).toBe(0);
    expect(store.getNode("root")).toBeDefined();
  });

  it("존재하지 않는 노드는 무시한다", () => {
    const result = executeUproot(store, { nodeIds: ["nonexistent"], edgeKeys: [] });
    expect(result.nodesRemoved).toBe(0);
  });

  it("노드 삭제 시 관련 edge도 CASCADE 삭제된다", () => {
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test", parentId: "root" }],
    });
    // growth edge 확인
    expect(store.getEdge("root", "file1", "contains")).toBeDefined();

    executeUproot(store, { nodeIds: ["file1"], edgeKeys: [] });
    expect(store.getEdge("root", "file1", "contains")).toBeUndefined();
  });

  it("edge만 선택 삭제한다", () => {
    executeSeed(store, {
      nodes: [
        { id: "file1", nodeType: "file", feature: "a", parentId: "root" },
        { id: "file2", nodeType: "file", feature: "b", parentId: "root" },
      ],
    });
    executeGraft(store, {
      branches: [],
      edges: [{ sourceId: "file1", targetId: "file2", edgeType: "imports", category: "root" }],
    });

    const result = executeUproot(store, {
      nodeIds: [],
      edgeKeys: [{ sourceId: "file1", targetId: "file2", edgeType: "imports" }],
    });
    expect(result.edgesRemoved).toBe(1);
    // 노드는 보존
    expect(store.getNode("file1")).toBeDefined();
    expect(store.getNode("file2")).toBeDefined();
  });

  it("leaf 삭제 후 고아 branch를 자동 정리한다", () => {
    // Security > Auth > file1 구조
    executeGraft(store, {
      branches: [
        { id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" },
        { id: "auth", nodeType: "category", feature: "Auth", parentId: "sec" },
      ],
      edges: [],
    });
    executeSeed(store, {
      nodes: [{ id: "file1", nodeType: "file", feature: "test", parentId: "auth" }],
    });

    const result = executeUproot(store, { nodeIds: ["file1"], edgeKeys: [] });
    expect(result.nodesRemoved).toBe(1);
    expect(result.orphansPruned).toBe(2); // auth + sec 정리
    expect(store.getNode("auth")).toBeUndefined();
    expect(store.getNode("sec")).toBeUndefined();
    expect(store.getNode("root")).toBeDefined(); // root는 보존
  });

  it("빈 입력은 no-op", () => {
    const result = executeUproot(store, { nodeIds: [], edgeKeys: [] });
    expect(result).toEqual({ nodesRemoved: 0, edgesRemoved: 0, orphansPruned: 0 });
  });
});
