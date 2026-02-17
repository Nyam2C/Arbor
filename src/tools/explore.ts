import { z } from "zod";
import type { ArborStore } from "../storage/sqlite-store.js";
import { NodeTypeSchema, EdgeTypeSchema, EdgeCategorySchema } from "../graph/models.js";
import { traverse, type TraversalResult } from "../graph/traversal.js";

// ---------------------------------------------------------------------------
// MCP 입력 스키마
// ---------------------------------------------------------------------------

export const ExploreInputSchema = z.object({
  startNodeIds: z.array(z.string()).min(1),
  direction: z.enum(["upstream", "downstream", "both"]),
  depth: z.number().int().min(1).max(10).default(3),
  nodeTypeFilter: z.array(NodeTypeSchema).default([]),
  edgeTypeFilter: z.array(EdgeTypeSchema).default([]),
  edgeCategoryFilter: z.array(EdgeCategorySchema).default([]),
});

export type ExploreInput = z.infer<typeof ExploreInputSchema>;
export type ExploreResult = TraversalResult;

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

export function executeExplore(store: ArborStore, input: ExploreInput): ExploreResult {
  return traverse(store, input.startNodeIds, {
    direction: input.direction,
    maxDepth: input.depth,
    nodeTypeFilter: input.nodeTypeFilter.length > 0 ? input.nodeTypeFilter : undefined,
    edgeTypeFilter: input.edgeTypeFilter.length > 0 ? input.edgeTypeFilter : undefined,
    edgeCategoryFilter: input.edgeCategoryFilter.length > 0 ? input.edgeCategoryFilter : undefined,
  });
}
