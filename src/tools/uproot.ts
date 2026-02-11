import { z } from "zod";
import type { ArborStore } from "../storage/sqlite-store.js";
import { pruneOrphans } from "../graph/pruner.js";

// ---------------------------------------------------------------------------
// MCP 입력 스키마 (camelCase)
// ---------------------------------------------------------------------------

const EdgeKeySchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  edgeType: z.string(),
});

export const UprootInputSchema = z.object({
  nodeIds: z.array(z.string()).default([]),
  edgeKeys: z.array(EdgeKeySchema).default([]),
});

export type UprootInput = z.infer<typeof UprootInputSchema>;
export type UprootResult = { nodesRemoved: number; edgesRemoved: number; orphansPruned: number };

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

export function executeUproot(store: ArborStore, input: UprootInput): UprootResult {
  let nodesRemoved = 0;
  let edgesRemoved = 0;
  let orphansPruned = 0;

  store.transaction(() => {
    // 1. 노드 삭제 (Root 보호)
    const parentIds: (string | null)[] = [];

    for (const id of input.nodeIds) {
      if (id === "root") continue;

      const node = store.getNode(id);
      if (!node) continue;

      parentIds.push(node.parent_id);
      store.deleteNode(id); // CASCADE로 관련 edge도 삭제
      nodesRemoved++;
    }

    // 2. Edge 삭제
    for (const key of input.edgeKeys) {
      const existing = store.getEdge(key.sourceId, key.targetId, key.edgeType);
      if (!existing) continue;

      store.deleteEdge(key.sourceId, key.targetId, key.edgeType);
      edgesRemoved++;
    }

    // 3. 고아 Branch 정리
    for (const parentId of parentIds) {
      orphansPruned += pruneOrphans(store, parentId);
    }
  });

  return { nodesRemoved, edgesRemoved, orphansPruned };
}
