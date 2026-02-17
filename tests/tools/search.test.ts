import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ArborStore } from "../../src/storage/sqlite-store.js";
import { executeGraft } from "../../src/tools/graft.js";
import { executeSeed } from "../../src/tools/seed.js";
import { executeSearch } from "../../src/tools/search.js";

const TEST_DB = path.resolve("tests/.test-search.db");

describe("executeSearch", () => {
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

    // Branch 구조
    executeGraft(store, {
      branches: [
        { id: "sec", nodeType: "functional_area", feature: "Security", parentId: "root" },
        { id: "auth", nodeType: "category", feature: "Authentication", parentId: "sec" },
        { id: "token", nodeType: "subcategory", feature: "TokenValidation", parentId: "auth" },
        { id: "api", nodeType: "functional_area", feature: "API", parentId: "root" },
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
          features: ["validate token", "refresh token", "JWT handling"],
          parentId: "token",
        },
        {
          id: "user-controller",
          nodeType: "file",
          feature: "user controller",
          features: ["create user", "delete user"],
          parentId: "api",
        },
        {
          id: "jwt-trap",
          nodeType: "pitfall",
          feature: "JWT expiration trap",
          features: ["token timeout issue"],
          parentId: "token",
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
      parent_id: "api",
      feature_path: "API/stale service",
    });
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("기본 FTS5 검색이 동작한다", () => {
    const result = executeSearch(store, {
      query: "auth",
      mode: "auto",
      scope: [],
      maxResults: 20,
      nodeTypeFilter: [],
    });

    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.nodeId);
    expect(ids).toContain("auth-service");
  });

  it("features 컬럼에서 검색한다 (snippets mode)", () => {
    const result = executeSearch(store, {
      query: "validate token",
      mode: "snippets",
      scope: [],
      maxResults: 20,
      nodeTypeFilter: [],
    });

    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.nodeId);
    expect(ids).toContain("auth-service");
  });

  it("features mode는 feature/feature_path에서만 검색한다", () => {
    const result = executeSearch(store, {
      query: "auth",
      mode: "features",
      scope: [],
      maxResults: 20,
      nodeTypeFilter: [],
    });

    expect(result.results.length).toBeGreaterThan(0);
    // auth-service의 feature가 "auth service"이므로 매칭됨
    const ids = result.results.map((r) => r.nodeId);
    expect(ids).toContain("auth-service");
  });

  it("scope prefix로 범위를 제한한다", () => {
    const result = executeSearch(store, {
      query: "service",
      mode: "auto",
      scope: ["Security"],
      maxResults: 20,
      nodeTypeFilter: [],
    });

    const ids = result.results.map((r) => r.nodeId);
    expect(ids).toContain("auth-service");
    // stale-service는 API 경로 아래이므로 제외
    expect(ids).not.toContain("stale-file");
  });

  it("nodeTypeFilter로 타입을 제한한다", () => {
    const result = executeSearch(store, {
      query: "JWT",
      mode: "auto",
      scope: [],
      maxResults: 20,
      nodeTypeFilter: ["pitfall"],
    });

    const ids = result.results.map((r) => r.nodeId);
    expect(ids).toContain("jwt-trap");
    // auth-service도 JWT 관련이지만 file 타입이므로 제외
    expect(ids).not.toContain("auth-service");
  });

  it("maxResults를 제한한다", () => {
    const result = executeSearch(store, {
      query: "service OR user OR token",
      mode: "auto",
      scope: [],
      maxResults: 2,
      nodeTypeFilter: [],
    });

    expect(result.results.length).toBeLessThanOrEqual(2);
  });

  it("빈 쿼리는 빈 결과를 반환한다", () => {
    const result = executeSearch(store, {
      query: "   ",
      mode: "auto",
      scope: [],
      maxResults: 20,
      nodeTypeFilter: [],
    });

    expect(result.results.length).toBe(0);
  });

  it("stale 플래그를 포함한다", () => {
    const result = executeSearch(store, {
      query: "stale",
      mode: "auto",
      scope: [],
      maxResults: 20,
      nodeTypeFilter: [],
    });

    const staleItem = result.results.find((r) => r.nodeId === "stale-file");
    if (staleItem) {
      expect(staleItem.stale).toBe(true);
    }
  });

  it("특수문자를 안전하게 처리한다", () => {
    // 에러 없이 동작하면 성공
    const result = executeSearch(store, {
      query: 'auth(service) "test" *wild*',
      mode: "auto",
      scope: [],
      maxResults: 20,
      nodeTypeFilter: [],
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("매칭 없는 검색은 빈 결과", () => {
    const result = executeSearch(store, {
      query: "zzzznonexistent",
      mode: "auto",
      scope: [],
      maxResults: 20,
      nodeTypeFilter: [],
    });

    expect(result.results.length).toBe(0);
    expect(result.totalFound).toBe(0);
  });
});
