import { z } from "zod";
import type { ArborStore } from "../storage/sqlite-store.js";
import { NodeTypeSchema } from "../graph/models.js";

// ---------------------------------------------------------------------------
// MCP 입력 스키마
// ---------------------------------------------------------------------------

export const SearchInputSchema = z.object({
  query: z.string().min(1),
  mode: z.enum(["features", "snippets", "auto"]).default("auto"),
  scope: z.array(z.string()).default([]),
  maxResults: z.number().int().min(1).max(100).default(20),
  nodeTypeFilter: z.array(NodeTypeSchema).default([]),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export interface SearchResultItem {
  nodeId: string;
  nodeType: string;
  feature: string;
  featurePath: string;
  score: number;
  stale: boolean;
}

export interface SearchResult {
  results: SearchResultItem[];
  totalFound: number;
}

// ---------------------------------------------------------------------------
// FTS5 쿼리 정제
// ---------------------------------------------------------------------------

/**
 * FTS5 특수문자 제거 + 토큰 분리. 빈 토큰은 제거.
 */
function sanitizeFtsQuery(raw: string): string {
  // FTS5 특수문자 제거: " * ( ) : ^ { } + -
  const cleaned = raw.replace(/["""*():^{}+-]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`);

  return tokens.join(" ");
}

/**
 * mode별 FTS5 컬럼 제한 접두사 생성.
 * - features: feature, feature_path 컬럼만 검색
 * - snippets: features 컬럼만 검색
 * - auto: 전체 컬럼 검색
 */
function buildFtsQuery(sanitized: string, mode: "features" | "snippets" | "auto"): string {
  if (!sanitized) return "";

  switch (mode) {
    case "features":
      return `{feature feature_path}: ${sanitized}`;
    case "snippets":
      return `{features}: ${sanitized}`;
    case "auto":
    default:
      return sanitized;
  }
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

export function executeSearch(store: ArborStore, input: SearchInput): SearchResult {
  const sanitized = sanitizeFtsQuery(input.query);
  if (!sanitized) {
    return { results: [], totalFound: 0 };
  }

  const ftsQuery = buildFtsQuery(sanitized, input.mode);

  // scope가 여러 개면 각 scope prefix로 검색 후 합산
  // scope가 없으면 전체 검색
  const scopePrefixes = input.scope.length > 0 ? input.scope : [undefined];

  const allResults: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const prefix of scopePrefixes) {
    const rows = store.searchNodes(ftsQuery, {
      nodeTypes: input.nodeTypeFilter.length > 0 ? input.nodeTypeFilter : undefined,
      scopePrefix: prefix,
      limit: input.maxResults,
    });

    for (const { node, score } of rows) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);

      allResults.push({
        nodeId: node.id,
        nodeType: node.node_type,
        feature: node.feature,
        featurePath: node.feature_path,
        score,
        stale: node.metadata.stale === true,
      });
    }
  }

  // 점수 내림차순 정렬
  allResults.sort((a, b) => b.score - a.score);

  const limited = allResults.slice(0, input.maxResults);

  return {
    results: limited,
    totalFound: allResults.length,
  };
}
