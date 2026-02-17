import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ArborStore } from "../../src/storage/sqlite-store.js";
import { executeGraft } from "../../src/tools/graft.js";
import { executeSeed } from "../../src/tools/seed.js";
import { executeExplore } from "../../src/tools/explore.js";

const TEST_DB = path.resolve("tests/.test-explore.db");

describe("executeExplore", () => {
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

    executeGraft(store, {
      branches: [
        { id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" },
        { id: "auth", nodeType: "category", feature: "Authentication", parentId: "sec" },
        { id: "token", nodeType: "subcategory", feature: "TokenValidation", parentId: "auth" },
      ],
      edges: [],
    });

    executeSeed(store, {
      nodes: [
        {
          id: "file-a",
          nodeType: "file",
          feature: "service A",
          parentId: "token",
        },
        {
          id: "file-b",
          nodeType: "file",
          feature: "service B",
          parentId: "token",
        },
        {
          id: "file-c",
          nodeType: "file",
          feature: "service C",
          parentId: "token",
        },
        {
          id: "pitfall-1",
          nodeType: "pitfall",
          feature: "common trap",
          parentId: "token",
        },
      ],
    });

    // stale 노드는 seed가 stale 제거하므로 직접 upsert
    store.upsertNode({
      id: "stale-node",
      level: "leaf",
      node_type: "file",
      feature: "stale file",
      features: [],
      metadata: { stale: true },
      parent_id: "token",
      feature_path: "Security/Authentication/TokenValidation/stale file",
    });

    // A → B → C 체인 (root edges)
    executeGraft(store, {
      branches: [],
      edges: [
        { sourceId: "file-a", targetId: "file-b", edgeType: "imports", category: "root" },
        { sourceId: "file-b", targetId: "file-c", edgeType: "imports", category: "root" },
        { sourceId: "file-b", targetId: "stale-node", edgeType: "invokes", category: "root" },
        {
          sourceId: "pitfall-1",
          targetId: "file-a",
          edgeType: "documents",
          category: "knowledge",
        },
      ],
    });
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("downstream으로 체인을 탐색한다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-a"],
      direction: "downstream",
      depth: 3,
      nodeTypeFilter: [],
      edgeTypeFilter: [],
      edgeCategoryFilter: ["root"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("file-a");
    expect(nodeIds).toContain("file-b");
    expect(nodeIds).toContain("file-c");
    expect(nodeIds).toContain("stale-node");
  });

  it("upstream으로 체인을 역추적한다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-c"],
      direction: "upstream",
      depth: 3,
      nodeTypeFilter: [],
      edgeTypeFilter: [],
      edgeCategoryFilter: ["root"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("file-c");
    expect(nodeIds).toContain("file-b");
    expect(nodeIds).toContain("file-a");
  });

  it("depth 제한이 동작한다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-a"],
      direction: "downstream",
      depth: 1,
      nodeTypeFilter: [],
      edgeTypeFilter: [],
      edgeCategoryFilter: ["root"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("file-a");
    expect(nodeIds).toContain("file-b");
    // depth 1이면 file-c에는 도달하지 않음
    expect(nodeIds).not.toContain("file-c");
  });

  it("staleWarnings를 반환한다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-a"],
      direction: "downstream",
      depth: 3,
      nodeTypeFilter: [],
      edgeTypeFilter: [],
      edgeCategoryFilter: ["root"],
    });

    expect(result.staleWarnings.length).toBeGreaterThanOrEqual(1);
    expect(result.staleWarnings.some((w) => w.nodeId === "stale-node")).toBe(true);
  });

  it("edgeTypeFilter로 특정 엣지만 따라간다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-b"],
      direction: "downstream",
      depth: 3,
      nodeTypeFilter: [],
      edgeTypeFilter: ["imports"],
      edgeCategoryFilter: ["root"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("file-c");
    // invokes edge는 필터링되어 stale-node에 도달하지 않음
    expect(nodeIds).not.toContain("stale-node");
  });

  it("nodeTypeFilter로 특정 타입만 수집한다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-a"],
      direction: "both",
      depth: 3,
      nodeTypeFilter: ["file"],
      edgeTypeFilter: [],
      edgeCategoryFilter: ["root", "knowledge"],
    });

    // 시작 노드 + file 타입만 수집 (pitfall은 제외)
    const collected = result.nodes.filter((n) => n.id !== "file-a");
    for (const n of collected) {
      expect(n.node_type).toBe("file");
    }
  });

  it("edgeCategoryFilter로 엣지 카테고리를 제한한다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-a"],
      direction: "both",
      depth: 3,
      nodeTypeFilter: [],
      edgeTypeFilter: [],
      edgeCategoryFilter: ["knowledge"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("pitfall-1");
    // root 카테고리가 제외되므로 file-b에 도달하지 않음
    expect(nodeIds).not.toContain("file-b");
  });

  it("both 방향으로 전체 탐색한다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-b"],
      direction: "both",
      depth: 3,
      nodeTypeFilter: [],
      edgeTypeFilter: [],
      edgeCategoryFilter: ["root"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("file-a");
    expect(nodeIds).toContain("file-b");
    expect(nodeIds).toContain("file-c");
    expect(nodeIds).toContain("stale-node");
  });

  it("paths를 반환한다", () => {
    const result = executeExplore(store, {
      startNodeIds: ["file-a"],
      direction: "downstream",
      depth: 3,
      nodeTypeFilter: [],
      edgeTypeFilter: [],
      edgeCategoryFilter: ["root"],
    });

    expect(result.paths.length).toBeGreaterThan(0);
    // 모든 path가 시작 노드에서 시작
    for (const p of result.paths) {
      expect(p.nodeIds[0]).toBe("file-a");
    }
  });
});
