import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ArborStore } from "./storage/sqlite-store.js";
import { SeedNodeSchema, executeSeed } from "./tools/seed.js";
import { GraftBranchSchema, GraftEdgeSchema, executeGraft } from "./tools/graft.js";
import { EdgeKeySchema, executeUproot } from "./tools/uproot.js";
import { executeSearch } from "./tools/search.js";
import { validateFetchInput, executeFetch } from "./tools/fetch.js";
import { executeExplore } from "./tools/explore.js";
import { executeCompound } from "./tools/compound.js";
import { NodeTypeSchema, EdgeTypeSchema, EdgeCategorySchema } from "./graph/models.js";

// ---------------------------------------------------------------------------
// MCP 서버 생성 + 도구 등록
// ---------------------------------------------------------------------------

export function createServer(store: ArborStore): McpServer {
  const server = new McpServer({
    name: "arbor",
    version: "0.1.0",
  });

  // --- arbor_seed: Leaf Node UPSERT ---
  server.registerTool(
    "arbor_seed",
    {
      description: "Leaf Node를 그래프에 저장 (UPSERT). 코드 노드와 교훈 노드 모두 지원.",
      inputSchema: {
        nodes: z.array(SeedNodeSchema).min(1),
      },
    },
    async (args) => {
      const result = executeSeed(store, { nodes: args.nodes });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  // --- arbor_graft: Branch Node + Edge 생성 ---
  server.registerTool(
    "arbor_graft",
    {
      description:
        "Branch Node와 Edge를 생성하여 트리 구조를 구축. parentId로 growth edge 자동 파생.",
      inputSchema: {
        branches: z.array(GraftBranchSchema).default([]),
        edges: z.array(GraftEdgeSchema).default([]),
      },
    },
    async (args) => {
      const result = executeGraft(store, {
        branches: args.branches,
        edges: args.edges,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  // --- arbor_uproot: 삭제 + 고아 정리 ---
  server.registerTool(
    "arbor_uproot",
    {
      description: "노드 또는 Edge를 삭제. 삭제 후 고아 Branch를 자동 정리.",
      inputSchema: {
        nodeIds: z.array(z.string()).default([]),
        edgeKeys: z.array(EdgeKeySchema).default([]),
      },
    },
    async (args) => {
      const result = executeUproot(store, {
        nodeIds: args.nodeIds,
        edgeKeys: args.edgeKeys,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  // --- arbor_search: FTS5 검색 ---
  server.registerTool(
    "arbor_search",
    {
      description: "FTS5 검색 + mtime stale 경고 포함.",
      inputSchema: {
        query: z.string().min(1),
        mode: z.enum(["features", "snippets", "auto"]).default("auto"),
        scope: z.array(z.string()).default([]),
        maxResults: z.number().int().min(1).max(100).default(20),
        nodeTypeFilter: z.array(NodeTypeSchema).default([]),
      },
    },
    async (args) => {
      const result = executeSearch(store, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  // --- arbor_fetch: 노드 상세 조회 ---
  server.registerTool(
    "arbor_fetch",
    {
      description: "노드 상세 + 자식 + 의존성 + stale 경고. filter: unplaced|stale 지원.",
      inputSchema: {
        nodeIds: z.array(z.string()).default([]),
        featurePaths: z.array(z.string()).default([]),
        includeDependencies: z.boolean().default(false),
        filter: z.enum(["unplaced", "stale"]).optional(),
      },
    },
    async (args) => {
      // MCP SDK가 .refine() 미지원 → 수동 검증
      validateFetchInput(args);
      const result = executeFetch(store, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  // --- arbor_explore: BFS 순회 ---
  server.registerTool(
    "arbor_explore",
    {
      description: "BFS 순회 + stale 경고.",
      inputSchema: {
        startNodeIds: z.array(z.string()).min(1),
        direction: z.enum(["upstream", "downstream", "both"]),
        depth: z.number().int().min(1).max(10).default(3),
        nodeTypeFilter: z.array(NodeTypeSchema).default([]),
        edgeTypeFilter: z.array(EdgeTypeSchema).default([]),
        edgeCategoryFilter: z.array(EdgeCategorySchema).default([]),
      },
    },
    async (args) => {
      const result = executeExplore(store, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  // --- arbor_compound: 교훈을 Leaf Node로 저장 + docs/solutions/ 이중 저장 ---
  server.registerTool(
    "arbor_compound",
    {
      description: "교훈을 Leaf Node로 저장 + docs/solutions/ 이중 저장.",
      inputSchema: {
        type: z.enum(["solution", "pattern", "pitfall"]),
        title: z.string().min(1),
        content: z.string().min(1),
        tags: z.array(z.string()),
        severity: z.enum(["P1", "P2", "P3"]).optional(),
        relatedNodeIds: z.array(z.string()).optional(),
        parentBranchId: z.string().optional(),
      },
    },
    async (args) => {
      const result = executeCompound(store, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// MCP 서버 실행 (stdio transport)
// ---------------------------------------------------------------------------

export async function startServer(store: ArborStore): Promise<void> {
  const server = createServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Arbor MCP Server running on stdio");
}
