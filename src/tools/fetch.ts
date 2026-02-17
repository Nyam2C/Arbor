import { z } from "zod";
import type { ArborStore } from "../storage/sqlite-store.js";
import type { ArborNode, ArborEdge } from "../graph/models.js";

// ---------------------------------------------------------------------------
// MCP 입력 스키마
// ---------------------------------------------------------------------------

// MCP SDK가 Zod .refine()을 지원하지 않으므로 base schema와 검증을 분리
export const FetchInputSchema = z.object({
  nodeIds: z.array(z.string()).default([]),
  featurePaths: z.array(z.string()).default([]),
  includeDependencies: z.boolean().default(false),
  filter: z.enum(["unplaced", "stale"]).optional(),
});

export function validateFetchInput(data: FetchInput): void {
  if (data.nodeIds.length === 0 && data.featurePaths.length === 0 && data.filter === undefined) {
    throw new Error("At least one of nodeIds, featurePaths, or filter must be provided");
  }
}

export type FetchInput = z.infer<typeof FetchInputSchema>;

export interface FetchResultItem {
  node: ArborNode;
  children: ArborNode[];
  dependencies?: ArborEdge[];
  stale: boolean;
}

export interface FetchResult {
  results: FetchResultItem[];
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

export function executeFetch(store: ArborStore, input: FetchInput): FetchResult {
  const nodeMap = new Map<string, ArborNode>();

  // 1. nodeIds 직접 조회
  if (input.nodeIds.length > 0) {
    for (const node of store.getNodes(input.nodeIds)) {
      nodeMap.set(node.id, node);
    }
  }

  // 2. featurePaths prefix 매칭
  for (const prefix of input.featurePaths) {
    for (const node of store.getNodesByFeaturePathPrefix(prefix)) {
      nodeMap.set(node.id, node);
    }
  }

  // 3. filter 처리
  if (input.filter) {
    const flaggedNodes = store.getNodesByMetadataFlag(input.filter);

    if (input.nodeIds.length > 0 || input.featurePaths.length > 0) {
      // nodeIds/featurePaths와 병용 → 교집합
      const flaggedIds = new Set(flaggedNodes.map((n) => n.id));
      for (const [id] of nodeMap) {
        if (!flaggedIds.has(id)) {
          nodeMap.delete(id);
        }
      }
    } else {
      // filter 단독 → 전체 flagged 노드
      for (const node of flaggedNodes) {
        nodeMap.set(node.id, node);
      }
    }
  }

  // 4. 각 노드에 대해 children + dependencies 조회
  const results: FetchResultItem[] = [];

  for (const node of nodeMap.values()) {
    const children = store.getChildren(node.id);

    let dependencies: ArborEdge[] | undefined;
    if (input.includeDependencies) {
      // 1-hop root edge (outgoing + incoming)
      const outgoing = store.getEdgesBySource(node.id, { category: "root" });
      const incoming = store.getEdgesByTarget(node.id, { category: "root" });
      dependencies = [...outgoing, ...incoming];
    }

    results.push({
      node,
      children,
      dependencies,
      stale: node.metadata.stale === true,
    });
  }

  return { results };
}
