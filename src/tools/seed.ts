import { z } from "zod";
import type { ArborStore } from "../storage/sqlite-store.js";
import { NodeTypeSchema } from "../graph/models.js";
import { buildFeaturePath } from "../graph/utils.js";

// ---------------------------------------------------------------------------
// MCP 입력 스키마 (camelCase)
// ---------------------------------------------------------------------------

export const SeedNodeSchema = z.object({
  id: z.string(),
  nodeType: NodeTypeSchema,
  feature: z.string(),
  features: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  parentId: z.string().nullable().optional(),
});

export const SeedInputSchema = z.object({
  nodes: z.array(SeedNodeSchema).min(1),
});

export type SeedInput = z.infer<typeof SeedInputSchema>;
export type SeedResult = { created: number; updated: number };

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

export function executeSeed(store: ArborStore, input: SeedInput): SeedResult {
  let created = 0;
  let updated = 0;

  store.transaction(() => {
    for (const node of input.nodes) {
      const existing = store.getNode(node.id);

      // metadata 처리: stale 제거, unplaced 설정/제거
      const metadata = { ...node.metadata };
      delete metadata.stale;

      if (node.parentId === undefined || node.parentId === null) {
        metadata.unplaced = true;
      } else {
        delete metadata.unplaced;
      }

      // feature_path 계산 (부모 체인 기반)
      const featurePath = buildFeaturePath(store, node.parentId ?? null, node.feature);

      // upsertNode (created_at 보존)
      store.upsertNode({
        id: node.id,
        level: "leaf",
        node_type: node.nodeType,
        feature: node.feature,
        features: node.features,
        metadata,
        parent_id: node.parentId ?? null,
        feature_path: featurePath,
        created_at: existing?.created_at,
      });

      // parentId 변경 시 growth edge 동기화
      const oldParentId = existing?.parent_id;

      if (node.parentId) {
        // 기존 growth edge 삭제 (parent 변경)
        if (oldParentId && oldParentId !== node.parentId) {
          store.deleteEdge(oldParentId, node.id, "contains");
        }

        // 새 growth edge 생성
        if (oldParentId !== node.parentId) {
          store.upsertEdge({
            source_id: node.parentId,
            target_id: node.id,
            edge_type: "contains",
            category: "growth",
            metadata: {},
          });
        }
      } else if (oldParentId) {
        // parentId 제거 시 기존 growth edge 정리
        store.deleteEdge(oldParentId, node.id, "contains");
      }

      if (existing) {
        updated++;
      } else {
        created++;
      }
    }
  });

  return { created, updated };
}
