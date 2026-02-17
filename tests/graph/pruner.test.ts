import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ArborStore } from "../../src/storage/sqlite-store.js";
import { pruneOrphans } from "../../src/graph/pruner.js";
import type { ArborNode } from "../../src/graph/models.js";

const TEST_DB = path.resolve("tests/.test-pruner.db");

function makeNode(overrides: Partial<ArborNode> & { id: string }): ArborNode {
  return {
    level: "branch",
    node_type: "category",
    feature: overrides.id,
    features: [],
    metadata: {},
    parent_id: null,
    feature_path: "",
    ...overrides,
  };
}

describe("pruneOrphans", () => {
  let store: ArborStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = new ArborStore(TEST_DB);
    store.upsertNode(makeNode({ id: "root", node_type: "functional_area", feature: "Root" }));
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("빈 branch를 삭제한다", () => {
    store.upsertNode(makeNode({ id: "a", parent_id: "root" }));
    // a에 자식이 없음 → 정리 대상
    const pruned = pruneOrphans(store, "a");
    expect(pruned).toBe(1);
    expect(store.getNode("a")).toBeUndefined();
  });

  it("자식이 있는 branch는 보존한다", () => {
    store.upsertNode(makeNode({ id: "a", parent_id: "root" }));
    store.upsertNode(makeNode({ id: "b", parent_id: "a" }));
    const pruned = pruneOrphans(store, "a");
    expect(pruned).toBe(0);
    expect(store.getNode("a")).toBeDefined();
  });

  it("leaf는 삭제하지 않는다", () => {
    store.upsertNode(
      makeNode({ id: "leaf1", level: "leaf", node_type: "file", parent_id: "root" }),
    );
    const pruned = pruneOrphans(store, "leaf1");
    expect(pruned).toBe(0);
    expect(store.getNode("leaf1")).toBeDefined();
  });

  it("Root 노드는 삭제하지 않는다", () => {
    const pruned = pruneOrphans(store, "root");
    expect(pruned).toBe(0);
    expect(store.getNode("root")).toBeDefined();
  });

  it("재귀적으로 빈 branch 체인을 정리한다", () => {
    store.upsertNode(makeNode({ id: "a", parent_id: "root" }));
    store.upsertNode(makeNode({ id: "b", parent_id: "a" }));
    store.upsertNode(makeNode({ id: "c", parent_id: "b" }));
    // c부터 시작 → c 삭제 → b 빈 branch → b 삭제 → a 빈 branch → a 삭제 → root는 보존
    const pruned = pruneOrphans(store, "c");
    expect(pruned).toBe(3);
    expect(store.getNode("c")).toBeUndefined();
    expect(store.getNode("b")).toBeUndefined();
    expect(store.getNode("a")).toBeUndefined();
    expect(store.getNode("root")).toBeDefined();
  });

  it("null startNodeId는 0을 반환한다", () => {
    const pruned = pruneOrphans(store, null);
    expect(pruned).toBe(0);
  });
});
