import { z } from "zod";
import type { ArborStore } from "../storage/sqlite-store.js";
import { EdgeTypeSchema, EdgeCategorySchema } from "../graph/models.js";

// ---------------------------------------------------------------------------
// MCP 입력 스키마 (camelCase)
// ---------------------------------------------------------------------------

const GraftBranchSchema = z.object({
  id: z.string(),
  nodeType: z.enum(["functional_area", "category", "subcategory"]),
  feature: z.string(),
  parentId: z.string().nullable().optional(),
});

const GraftEdgeSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  edgeType: EdgeTypeSchema,
  category: EdgeCategorySchema,
});

export const GraftInputSchema = z.object({
  branches: z.array(GraftBranchSchema).default([]),
  edges: z.array(GraftEdgeSchema).default([]),
});

export type GraftInput = z.infer<typeof GraftInputSchema>;
export type GraftResult = { branchesCreated: number; edgesCreated: number };

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

function buildFeaturePath(
  store: ArborStore,
  parentId: string | null | undefined,
  feature: string,
): string {
  if (!parentId) return feature;

  const parent = store.getNode(parentId);
  if (!parent) return feature;

  return parent.feature_path ? `${parent.feature_path}/${feature}` : feature;
}

export function executeGraft(store: ArborStore, input: GraftInput): GraftResult {
  let branchesCreated = 0;
  let edgesCreated = 0;

  store.transaction(() => {
    // 1. Branch 노드 생성
    for (const branch of input.branches) {
      const existing = store.getNode(branch.id);
      const featurePath = buildFeaturePath(store, branch.parentId, branch.feature);

      store.upsertNode({
        id: branch.id,
        level: "branch",
        node_type: branch.nodeType,
        feature: branch.feature,
        features: [],
        metadata: {},
        parent_id: branch.parentId ?? null,
        feature_path: featurePath,
        created_at: existing?.created_at,
      });

      // parentId → growth edge 자동 생성
      if (branch.parentId) {
        if (existing?.parent_id && existing.parent_id !== branch.parentId) {
          store.deleteEdge(existing.parent_id, branch.id, "contains");
        }

        store.upsertEdge({
          source_id: branch.parentId,
          target_id: branch.id,
          edge_type: "contains",
          category: "growth",
          metadata: {},
        });
      }

      branchesCreated++;
    }

    // 2. Edge 생성 (growth 카테고리는 거부 — parentId로만 관리)
    for (const edge of input.edges) {
      if (edge.category === "growth") continue;

      // 대상 노드의 unplaced 제거
      const targetNode = store.getNode(edge.targetId);
      if (targetNode && targetNode.metadata.unplaced) {
        const { unplaced: _, ...cleanMetadata } = targetNode.metadata;
        store.upsertNode({ ...targetNode, metadata: cleanMetadata });
      }

      store.upsertEdge({
        source_id: edge.sourceId,
        target_id: edge.targetId,
        edge_type: edge.edgeType,
        category: edge.category,
        metadata: {},
      });

      edgesCreated++;
    }
  });

  return { branchesCreated, edgesCreated };
}
