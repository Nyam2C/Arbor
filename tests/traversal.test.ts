import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ArborStore } from "../src/storage/sqlite-store.js";
import { executeGraft } from "../src/tools/graft.js";
import { executeSeed } from "../src/tools/seed.js";
import { traverse, getImpactRadius } from "../src/graph/traversal.js";

const TEST_DB = path.resolve("tests/.test-traversal.db");

/**
 * 테스트 그래프 구조:
 *
 * root
 * ├── Security (functional_area)
 * │   └── Auth (category)
 * │       └── Token (subcategory)
 * │           ├── auth-service.ts (file) --imports--> user-controller.ts (root edge)
 * │           ├── "JWT trap" (pitfall) --documents--> auth-service.ts (knowledge edge)
 * │           └── validate() (method, stale)
 * └── API (functional_area)
 *     └── UserCtrl (category)
 *         └── CRUD (subcategory)
 *             └── user-controller.ts (file)
 */
function setupTestGraph(store: ArborStore) {
  // Branch 구조
  executeGraft(store, {
    branches: [
      { id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" },
      { id: "auth", nodeType: "category", feature: "Authentication", parentId: "sec" },
      { id: "token", nodeType: "subcategory", feature: "TokenValidation", parentId: "auth" },
      { id: "api", nodeType: "functional_area", feature: "API", parentId: "root" },
      { id: "user-ctrl", nodeType: "category", feature: "UserController", parentId: "api" },
      { id: "crud", nodeType: "subcategory", feature: "CRUD", parentId: "user-ctrl" },
    ],
    edges: [],
  });

  // Leaf 노드
  executeSeed(store, {
    nodes: [
      {
        id: "auth-service",
        nodeType: "file",
        feature: "auth service",
        features: ["validate token", "refresh token"],
        parentId: "token",
      },
      {
        id: "user-controller",
        nodeType: "file",
        feature: "user controller",
        features: ["create user", "delete user"],
        parentId: "crud",
      },
      {
        id: "jwt-trap",
        nodeType: "pitfall",
        feature: "JWT expiration trap",
        parentId: "token",
      },
      {
        id: "validate-method",
        nodeType: "method",
        feature: "validate",
        parentId: "token",
      },
    ],
  });

  // stale 노드는 seed가 stale 제거하므로 직접 upsert
  store.upsertNode({
    id: "validate-method",
    level: "leaf",
    node_type: "method",
    feature: "validate",
    features: [],
    metadata: { stale: true },
    parent_id: "token",
    feature_path: "Security/Authentication/TokenValidation/validate",
  });

  // Root edge: auth-service imports user-controller
  executeGraft(store, {
    branches: [],
    edges: [
      {
        sourceId: "auth-service",
        targetId: "user-controller",
        edgeType: "imports",
        category: "root",
      },
    ],
  });

  // Knowledge edge: jwt-trap documents auth-service
  executeGraft(store, {
    branches: [],
    edges: [
      {
        sourceId: "jwt-trap",
        targetId: "auth-service",
        edgeType: "documents",
        category: "knowledge",
      },
    ],
  });
}

describe("traverse", () => {
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
    setupTestGraph(store);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("downstream으로 root edge를 따라간다", () => {
    const result = traverse(store, ["auth-service"], {
      direction: "downstream",
      edgeCategoryFilter: ["root"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("auth-service");
    expect(nodeIds).toContain("user-controller");
    expect(result.edges.length).toBe(1);
    expect(result.edges[0].edge_type).toBe("imports");
  });

  it("upstream으로 root edge를 따라간다", () => {
    const result = traverse(store, ["user-controller"], {
      direction: "upstream",
      edgeCategoryFilter: ["root"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("user-controller");
    expect(nodeIds).toContain("auth-service");
  });

  it("both 방향으로 root + knowledge edge를 따라간다", () => {
    const result = traverse(store, ["auth-service"], {
      direction: "both",
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("auth-service");
    expect(nodeIds).toContain("user-controller");
    expect(nodeIds).toContain("jwt-trap");
  });

  it("depth를 제한한다", () => {
    const result = traverse(store, ["auth-service"], {
      direction: "both",
      maxDepth: 0,
    });

    // depth 0이면 시작 노드만
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe("auth-service");
  });

  it("순환을 방지한다 (visited Set)", () => {
    // A → B, B → A 순환 엣지 추가
    executeSeed(store, {
      nodes: [
        { id: "cycle-a", nodeType: "file", feature: "cycle A", parentId: "token" },
        { id: "cycle-b", nodeType: "file", feature: "cycle B", parentId: "token" },
      ],
    });
    executeGraft(store, {
      branches: [],
      edges: [
        { sourceId: "cycle-a", targetId: "cycle-b", edgeType: "invokes", category: "root" },
        { sourceId: "cycle-b", targetId: "cycle-a", edgeType: "invokes", category: "root" },
      ],
    });

    const result = traverse(store, ["cycle-a"], {
      direction: "both",
      maxDepth: 10,
      edgeCategoryFilter: ["root"],
    });

    // 순환에도 불구하고 각 노드는 한 번만 등장
    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds.filter((id) => id === "cycle-a").length).toBe(1);
    expect(nodeIds.filter((id) => id === "cycle-b").length).toBe(1);
  });

  it("staleWarnings를 수집한다", () => {
    // 직접 stale 노드를 시작점으로 테스트
    const result2 = traverse(store, ["validate-method"], {
      direction: "both",
    });

    expect(result2.staleWarnings.length).toBeGreaterThanOrEqual(1);
    expect(result2.staleWarnings[0].nodeId).toBe("validate-method");
  });

  it("edgeTypeFilter로 특정 엣지만 따라간다", () => {
    const result = traverse(store, ["auth-service"], {
      direction: "both",
      edgeTypeFilter: ["documents"],
    });

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("jwt-trap");
    // imports edge는 필터링되어 user-controller에 도달하지 않음
    expect(nodeIds).not.toContain("user-controller");
  });

  it("nodeTypeFilter로 특정 타입만 수집한다", () => {
    const result = traverse(store, ["auth-service"], {
      direction: "both",
      nodeTypeFilter: ["pitfall"],
    });

    const collected = result.nodes.filter((n) => n.id !== "auth-service");
    expect(collected.every((n) => n.node_type === "pitfall")).toBe(true);
    // jwt-trap이 knowledge edge로 연결되어 도달 가능
    expect(collected.some((n) => n.id === "jwt-trap")).toBe(true);
  });

  it("nodeTypeFilter는 순회를 차단하지 않는다", () => {
    // A(file) --imports--> B(file) --documents--> C(pitfall) 체인 구성
    executeSeed(store, {
      nodes: [
        { id: "chain-a", nodeType: "file", feature: "chain A", parentId: "token" },
        { id: "chain-b", nodeType: "file", feature: "chain B", parentId: "token" },
        { id: "chain-c", nodeType: "pitfall", feature: "chain C pitfall", parentId: "token" },
      ],
    });
    executeGraft(store, {
      branches: [],
      edges: [
        { sourceId: "chain-a", targetId: "chain-b", edgeType: "imports", category: "root" },
        { sourceId: "chain-b", targetId: "chain-c", edgeType: "documents", category: "knowledge" },
      ],
    });

    // pitfall만 수집하되, file 노드를 통과해서 도달해야 함
    const result = traverse(store, ["chain-a"], {
      direction: "downstream",
      maxDepth: 5,
      nodeTypeFilter: ["pitfall"],
    });

    const collected = result.nodes.filter((n) => n.id !== "chain-a");
    expect(collected.length).toBe(1);
    expect(collected[0].id).toBe("chain-c");
    expect(collected[0].node_type).toBe("pitfall");
  });

  it("존재하지 않는 시작 노드는 무시한다", () => {
    const result = traverse(store, ["nonexistent"], {
      direction: "downstream",
    });

    expect(result.nodes.length).toBe(0);
    expect(result.edges.length).toBe(0);
  });

  it("path를 기록한다", () => {
    const result = traverse(store, ["auth-service"], {
      direction: "downstream",
      edgeCategoryFilter: ["root"],
    });

    expect(result.paths.length).toBeGreaterThanOrEqual(1);
    const path = result.paths.find((p) => p.nodeIds.includes("user-controller"));
    expect(path).toBeDefined();
    expect(path!.nodeIds[0]).toBe("auth-service");
    expect(path!.nodeIds[path!.nodeIds.length - 1]).toBe("user-controller");
  });
});

describe("getImpactRadius", () => {
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
    setupTestGraph(store);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("root + knowledge edge로 영향 범위를 조회한다", () => {
    const result = getImpactRadius(store, ["auth-service"]);

    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain("auth-service");
    expect(nodeIds).toContain("user-controller");
    expect(nodeIds).toContain("jwt-trap");
  });
});
