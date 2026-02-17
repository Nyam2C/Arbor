import type { ArborStore } from "../storage/sqlite-store.js";

/**
 * 부모 체인을 따라 feature_path를 구성한다.
 * Root의 feature_path는 빈 문자열이므로, Root 바로 아래 노드는 feature만 반환.
 */
export function buildFeaturePath(
  store: ArborStore,
  parentId: string | null | undefined,
  feature: string,
): string {
  if (!parentId) return feature;

  const parent = store.getNode(parentId);
  if (!parent) return feature;

  return parent.feature_path ? `${parent.feature_path}/${feature}` : feature;
}
