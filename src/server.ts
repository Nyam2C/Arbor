import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ArborStore } from "./storage/sqlite-store.js";
import { SeedNodeSchema, executeSeed } from "./tools/seed.js";
import { GraftBranchSchema, GraftEdgeSchema, executeGraft } from "./tools/graft.js";
import { EdgeKeySchema, executeUproot } from "./tools/uproot.js";

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
