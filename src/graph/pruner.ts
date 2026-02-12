import type { ArborStore } from "../storage/sqlite-store.js";

const MAX_DEPTH = 20;

/**
 * 삭제된 노드의 부모부터 시작하여, 자식이 없는 branch를 재귀적으로 정리한다.
 * - Branch만 대상 (leaf는 보존)
 * - Root 노드(id="root")는 절대 삭제하지 않음
 * - 최대 깊이 제한으로 무한 루프 방지
 *
 * @returns 정리된 노드 수
 */
export function pruneOrphans(store: ArborStore, startNodeId: string | null): number {
  let pruned = 0;
  let currentId = startNodeId;
  let depth = 0;

  while (currentId && currentId !== "root" && depth < MAX_DEPTH) {
    const node = store.getNode(currentId);
    if (!node) break;

    // leaf는 보존
    if (node.level !== "branch") break;

    const children = store.getChildren(currentId);
    // 자식이 있으면 정리 중단
    if (children.length > 0) break;

    const parentId = node.parent_id;
    store.deleteNode(currentId);
    pruned++;

    currentId = parentId;
    depth++;
  }

  return pruned;
}
