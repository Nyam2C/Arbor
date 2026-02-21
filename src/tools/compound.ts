import type { ArborStore } from "../storage/sqlite-store.js";
import { executeSeed } from "./seed.js";
import { writeSolutionFile } from "../knowledge/writer.js";
import { toKebabCase } from "../knowledge/writer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompoundInput {
  type: "solution" | "pattern" | "pitfall";
  title: string;
  content: string;
  tags: string[];
  severity?: "P1" | "P2" | "P3";
  relatedNodeIds?: string[];
  parentBranchId?: string;
}

export interface CompoundResult {
  nodeId: string;
  filePath: string | null;
  edgesCreated: number;
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

export function executeCompound(store: ArborStore, input: CompoundInput): CompoundResult {
  const nodeId = `knowledge:${input.type}:${toKebabCase(input.title)}`;

  // 1. Leaf 노드 생성 via executeSeed
  executeSeed(store, {
    nodes: [
      {
        id: nodeId,
        nodeType: input.type,
        feature: input.title,
        features: input.tags,
        metadata: {
          severity: input.severity ?? null,
          content: input.content,
        },
        parentId: input.parentBranchId ?? null,
      },
    ],
  });

  // 2. Knowledge edges (documents) 생성
  let edgesCreated = 0;
  const relatedIds = input.relatedNodeIds ?? [];

  if (relatedIds.length > 0) {
    store.transaction(() => {
      for (const targetId of relatedIds) {
        // 존재하지 않는 target 스킵
        const target = store.getNode(targetId);
        if (!target) continue;

        store.upsertEdge({
          source_id: nodeId,
          target_id: targetId,
          edge_type: "documents",
          category: "knowledge",
          metadata: {},
        });
        edgesCreated++;
      }
    });
  }

  // 3. docs/solutions/ 파일 생성 (실패 시 catch, 노드는 이미 저장됨)
  let filePath: string | null = null;
  const projectRoot = store.getMeta("project_root");
  if (projectRoot) {
    try {
      filePath = writeSolutionFile(projectRoot, {
        title: input.title,
        type: input.type,
        content: input.content,
        tags: input.tags,
        severity: input.severity,
      });
    } catch {
      // 파일 쓰기 실패 — 노드는 이미 저장됨
    }
  }

  return { nodeId, filePath, edgesCreated };
}
