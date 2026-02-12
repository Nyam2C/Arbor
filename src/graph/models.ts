import { z } from "zod";

// ---------------------------------------------------------------------------
// Enum Schemas
// ---------------------------------------------------------------------------

export const NodeTypeSchema = z.enum([
  // branch types (3단계 계층)
  "functional_area",
  "category",
  "subcategory",
  // leaf types (코드)
  "file",
  "class",
  "function",
  "method",
  // leaf types (교훈)
  "solution",
  "pattern",
  "pitfall",
]);

export const LevelSchema = z.enum(["branch", "leaf"]);

export const EdgeTypeSchema = z.enum([
  "contains",
  "composes",
  "invokes",
  "imports",
  "inherits",
  "documents",
]);

export const EdgeCategorySchema = z.enum(["growth", "root", "knowledge"]);

// ---------------------------------------------------------------------------
// Node Schema
// ---------------------------------------------------------------------------

export const ArborNodeSchema = z.object({
  id: z.string(),
  level: LevelSchema,
  node_type: NodeTypeSchema,
  feature: z.string(),
  features: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  parent_id: z.string().nullable(),
  feature_path: z.string().default(""),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Edge Schema
// ---------------------------------------------------------------------------

export const ArborEdgeSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  edge_type: EdgeTypeSchema,
  category: EdgeCategorySchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Inferred Types
// ---------------------------------------------------------------------------

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type EdgeType = z.infer<typeof EdgeTypeSchema>;
export type EdgeCategory = z.infer<typeof EdgeCategorySchema>;
export type ArborNode = z.infer<typeof ArborNodeSchema>;
export type ArborEdge = z.infer<typeof ArborEdgeSchema>;
