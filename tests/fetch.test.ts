import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ArborStore } from "../src/storage/sqlite-store.js";
import { executeGraft } from "../src/tools/graft.js";
import { executeSeed } from "../src/tools/seed.js";
import { executeFetch } from "../src/tools/fetch.js";

const TEST_DB = path.resolve("tests/.test-fetch.db");

describe("executeFetch", () => {
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
          id: "auth-service",
          nodeType: "file",
          feature: "auth service",
          features: ["validate token"],
          parentId: "token",
        },
        {
          id: "user-controller",
          nodeType: "file",
          feature: "user controller",
          parentId: "token",
        },
        {
          id: "unplaced-file",
          nodeType: "file",
          feature: "orphan file",
        },
      ],
    });

    // stale 노드는 seed가 stale 제거하므로 직접 upsert
    store.upsertNode({
      id: "stale-file",
      level: "leaf",
      node_type: "file",
      feature: "stale service",
      features: [],
      metadata: { stale: true },
      parent_id: "token",
      feature_path: "Security/Authentication/TokenValidation/stale service",
    });

    // root edge
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
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("nodeIds로 노드를 조회한다", () => {
    const result = executeFetch(store, {
      nodeIds: ["auth-service"],
      featurePaths: [],
      includeDependencies: false,
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].node.id).toBe("auth-service");
  });

  it("여러 nodeIds를 한번에 조회한다", () => {
    const result = executeFetch(store, {
      nodeIds: ["auth-service", "user-controller"],
      featurePaths: [],
      includeDependencies: false,
    });

    expect(result.results.length).toBe(2);
  });

  it("존재하지 않는 nodeId는 스킵한다", () => {
    const result = executeFetch(store, {
      nodeIds: ["auth-service", "nonexistent"],
      featurePaths: [],
      includeDependencies: false,
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].node.id).toBe("auth-service");
  });

  it("featurePath prefix로 노드를 조회한다", () => {
    const result = executeFetch(store, {
      nodeIds: [],
      featurePaths: ["Security/Authentication/TokenValidation"],
      includeDependencies: false,
    });

    // token 아래의 모든 노드
    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.node.id);
    expect(ids).toContain("auth-service");
    expect(ids).toContain("user-controller");
  });

  it("children을 포함한다", () => {
    const result = executeFetch(store, {
      nodeIds: ["token"],
      featurePaths: [],
      includeDependencies: false,
    });

    expect(result.results[0].children.length).toBeGreaterThan(0);
    const childIds = result.results[0].children.map((c) => c.id);
    expect(childIds).toContain("auth-service");
    expect(childIds).toContain("user-controller");
  });

  it("includeDependencies로 1-hop root edge를 조회한다", () => {
    const result = executeFetch(store, {
      nodeIds: ["auth-service"],
      featurePaths: [],
      includeDependencies: true,
    });

    expect(result.results[0].dependencies).toBeDefined();
    expect(result.results[0].dependencies!.length).toBeGreaterThan(0);
    const dep = result.results[0].dependencies![0];
    expect(dep.edge_type).toBe("imports");
  });

  it("includeDependencies=false이면 dependencies 없음", () => {
    const result = executeFetch(store, {
      nodeIds: ["auth-service"],
      featurePaths: [],
      includeDependencies: false,
    });

    expect(result.results[0].dependencies).toBeUndefined();
  });

  it("filter=unplaced로 미배치 노드를 조회한다", () => {
    const result = executeFetch(store, {
      nodeIds: [],
      featurePaths: [],
      includeDependencies: false,
      filter: "unplaced",
    });

    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.node.id);
    expect(ids).toContain("unplaced-file");
  });

  it("filter=stale로 스테일 노드를 조회한다", () => {
    const result = executeFetch(store, {
      nodeIds: [],
      featurePaths: [],
      includeDependencies: false,
      filter: "stale",
    });

    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.node.id);
    expect(ids).toContain("stale-file");
  });

  it("stale 플래그를 반환한다", () => {
    const result = executeFetch(store, {
      nodeIds: ["stale-file"],
      featurePaths: [],
      includeDependencies: false,
    });

    expect(result.results[0].stale).toBe(true);
  });

  it("filter + nodeIds 병용 시 교집합", () => {
    const result = executeFetch(store, {
      nodeIds: ["auth-service", "stale-file"],
      featurePaths: [],
      includeDependencies: false,
      filter: "stale",
    });

    // auth-service는 stale이 아니므로 제외, stale-file만 남음
    expect(result.results.length).toBe(1);
    expect(result.results[0].node.id).toBe("stale-file");
  });
});
