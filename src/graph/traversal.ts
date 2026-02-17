import type { ArborStore } from "../storage/sqlite-store.js";
import type { ArborNode, ArborEdge } from "./models.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraversalOptions {
  direction: "upstream" | "downstream" | "both";
  maxDepth?: number;
  edgeTypeFilter?: string[];
  nodeTypeFilter?: string[];
  edgeCategoryFilter?: string[];
}

export interface StaleWarning {
  nodeId: string;
  feature: string;
  featurePath: string;
}

export interface TraversalResult {
  nodes: ArborNode[];
  edges: ArborEdge[];
  paths: Array<{ nodeIds: string[] }>;
  staleWarnings: StaleWarning[];
}

// ---------------------------------------------------------------------------
// BFS Traversal
// ---------------------------------------------------------------------------

const MAX_DEPTH = 10;
const DEFAULT_DEPTH = 3;
const DEFAULT_CATEGORIES = ["root", "knowledge"];

export function traverse(
  store: ArborStore,
  startIds: string[],
  options: TraversalOptions,
): TraversalResult {
  const maxDepth = Math.min(options.maxDepth ?? DEFAULT_DEPTH, MAX_DEPTH);
  const categories = options.edgeCategoryFilter ?? DEFAULT_CATEGORIES;

  const visited = new Set<string>();
  const collectedNodes: ArborNode[] = [];
  const collectedEdges: ArborEdge[] = [];
  const paths: Array<{ nodeIds: string[] }> = [];
  const staleWarnings: StaleWarning[] = [];

  // edgeKey로 중복 방지
  const edgeSet = new Set<string>();
  const edgeKey = (e: ArborEdge) => `${e.source_id}|${e.target_id}|${e.edge_type}`;

  // 시작 노드 초기화
  for (const id of startIds) {
    const node = store.getNode(id);
    if (!node) continue;

    visited.add(id);
    collectedNodes.push(node);
    checkStale(node, staleWarnings);
  }

  // BFS queue: [nodeId, currentPath, currentDepth]
  const queue: Array<[string, string[], number]> = startIds
    .filter((id) => visited.has(id))
    .map((id) => [id, [id], 0]);

  while (queue.length > 0) {
    const [currentId, currentPath, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighborEdges = getNeighborEdges(store, currentId, options.direction, categories);

    for (const edge of neighborEdges) {
      // 엣지 타입 필터
      if (options.edgeTypeFilter && !options.edgeTypeFilter.includes(edge.edge_type)) {
        continue;
      }

      const neighborId = edge.source_id === currentId ? edge.target_id : edge.source_id;

      // 엣지 수집 (중복 방지)
      const ek = edgeKey(edge);
      if (!edgeSet.has(ek)) {
        edgeSet.add(ek);
        collectedEdges.push(edge);
      }

      if (visited.has(neighborId)) continue;
      visited.add(neighborId);

      const neighborNode = store.getNode(neighborId);
      if (!neighborNode) continue;

      // 항상 큐에 추가하여 순회 계속 (nodeTypeFilter는 수집만 제한)
      const newPath = [...currentPath, neighborId];
      queue.push([neighborId, newPath, depth + 1]);

      // 노드 타입 필터: 수집 여부만 결정 (순회는 차단하지 않음)
      if (options.nodeTypeFilter && !options.nodeTypeFilter.includes(neighborNode.node_type)) {
        continue;
      }

      collectedNodes.push(neighborNode);
      checkStale(neighborNode, staleWarnings);
      paths.push({ nodeIds: newPath });
    }
  }

  return { nodes: collectedNodes, edges: collectedEdges, paths, staleWarnings };
}

/**
 * upstream root 순회 후 knowledge edge로 관련 교훈 수집.
 * Phase 3 arbor_review에서 재사용 가능.
 */
export function getImpactRadius(
  store: ArborStore,
  nodeIds: string[],
  maxDepth?: number,
): TraversalResult {
  return traverse(store, nodeIds, {
    direction: "both",
    maxDepth: maxDepth ?? 2,
    edgeCategoryFilter: ["root", "knowledge"],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNeighborEdges(
  store: ArborStore,
  nodeId: string,
  direction: "upstream" | "downstream" | "both",
  categories: string[],
): ArborEdge[] {
  const edges: ArborEdge[] = [];

  if (direction === "downstream" || direction === "both") {
    for (const cat of categories) {
      edges.push(...store.getEdgesBySource(nodeId, { category: cat }));
    }
  }

  if (direction === "upstream" || direction === "both") {
    for (const cat of categories) {
      edges.push(...store.getEdgesByTarget(nodeId, { category: cat }));
    }
  }

  return edges;
}

function checkStale(node: ArborNode, warnings: StaleWarning[]): void {
  if (node.metadata.stale) {
    warnings.push({
      nodeId: node.id,
      feature: node.feature,
      featurePath: node.feature_path,
    });
  }
}
