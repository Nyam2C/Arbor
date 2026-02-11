import { z } from "zod";
import type { ArborStore } from "../storage/sqlite-store.js";
import { NodeTypeSchema } from "../graph/models.js";

// ---------------------------------------------------------------------------
// MCP 입력 스키마 (camelCase)
// ---------------------------------------------------------------------------

const SeedNodeSchema = z.object({
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

      // upsertNode (created_at 보존)
      store.upsertNode({
        id: node.id,
        level: "leaf",
        node_type: node.nodeType,
        feature: node.feature,
        features: node.features,
        metadata,
        parent_id: node.parentId ?? null,
        feature_path: "",
        created_at: existing?.created_at,
      });

      // parentId 변경 시 growth edge 동기화
      if (node.parentId) {
        const oldParentId = existing?.parent_id;

        // 기존 growth edge 삭제
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
