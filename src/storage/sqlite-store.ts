import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";
import type { ArborNode, ArborEdge } from "../graph/models.js";

export class ArborStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    runMigrations(this.db);
  }

  // ---------------------------------------------------------------------------
  // Node operations
  // ---------------------------------------------------------------------------

  getNode(id: string): ArborNode | undefined {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) return undefined;
    return this.parseNode(row);
  }

  upsertNode(node: ArborNode): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO nodes
           (id, level, node_type, feature, features, metadata, parent_id, feature_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        node.id,
        node.level,
        node.node_type,
        node.feature,
        JSON.stringify(node.features),
        JSON.stringify(node.metadata),
        node.parent_id ?? null,
        node.feature_path,
        node.created_at ?? new Date().toISOString(),
        new Date().toISOString(),
      );
  }

  deleteNode(id: string): void {
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  }

  // ---------------------------------------------------------------------------
  // Edge operations
  // ---------------------------------------------------------------------------

  getEdge(sourceId: string, targetId: string, edgeType: string): ArborEdge | undefined {
    const row = this.db
      .prepare("SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND edge_type = ?")
      .get(sourceId, targetId, edgeType) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this.parseEdge(row);
  }

  upsertEdge(edge: ArborEdge): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO edges
           (source_id, target_id, edge_type, category, metadata)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        edge.source_id,
        edge.target_id,
        edge.edge_type,
        edge.category,
        JSON.stringify(edge.metadata),
      );
  }

  deleteEdge(sourceId: string, targetId: string, edgeType: string): void {
    this.db
      .prepare("DELETE FROM edges WHERE source_id = ? AND target_id = ? AND edge_type = ?")
      .run(sourceId, targetId, edgeType);
  }

  // ---------------------------------------------------------------------------
  // Batch / filter queries
  // ---------------------------------------------------------------------------

  getNodes(ids: string[]): ArborNode[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
      .all(...ids) as Record<string, unknown>[];
    return rows.map((row) => this.parseNode(row));
  }

  getNodesByFeaturePathPrefix(prefix: string): ArborNode[] {
    const rows = this.db
      .prepare("SELECT * FROM nodes WHERE feature_path LIKE ? || '%'")
      .all(prefix) as Record<string, unknown>[];
    return rows.map((row) => this.parseNode(row));
  }

  getNodesByMetadataFlag(flag: "unplaced" | "stale"): ArborNode[] {
    // unplaced = parent_id IS NULL AND level = 'leaf'
    // stale = metadata contains "stale":true
    if (flag === "unplaced") {
      const rows = this.db
        .prepare("SELECT * FROM nodes WHERE parent_id IS NULL AND level = 'leaf'")
        .all() as Record<string, unknown>[];
      return rows.map((row) => this.parseNode(row));
    }
    // stale: JSON metadata 내부에서 stale:true 검색
    const rows = this.db
      .prepare("SELECT * FROM nodes WHERE json_extract(metadata, '$.stale') = 1")
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.parseNode(row));
  }

  // ---------------------------------------------------------------------------
  // Edge queries
  // ---------------------------------------------------------------------------

  getEdgesBySource(sourceId: string, options?: { category?: string }): ArborEdge[] {
    if (options?.category) {
      const rows = this.db
        .prepare("SELECT * FROM edges WHERE source_id = ? AND category = ?")
        .all(sourceId, options.category) as Record<string, unknown>[];
      return rows.map((row) => this.parseEdge(row));
    }
    const rows = this.db.prepare("SELECT * FROM edges WHERE source_id = ?").all(sourceId) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => this.parseEdge(row));
  }

  getEdgesByTarget(targetId: string, options?: { category?: string }): ArborEdge[] {
    if (options?.category) {
      const rows = this.db
        .prepare("SELECT * FROM edges WHERE target_id = ? AND category = ?")
        .all(targetId, options.category) as Record<string, unknown>[];
      return rows.map((row) => this.parseEdge(row));
    }
    const rows = this.db.prepare("SELECT * FROM edges WHERE target_id = ?").all(targetId) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => this.parseEdge(row));
  }

  // ---------------------------------------------------------------------------
  // FTS5 search
  // ---------------------------------------------------------------------------

  searchNodes(
    ftsQuery: string,
    options?: { nodeTypes?: string[]; scopePrefix?: string; limit?: number },
  ): Array<{ node: ArborNode; score: number }> {
    const limit = options?.limit ?? 20;

    // 기본 FTS5 매칭 + rank 점수
    let sql = `
      SELECT n.*, rank AS score
      FROM nodes_fts f
      JOIN nodes n ON n.id = f.id
      WHERE nodes_fts MATCH ?`;
    const params: unknown[] = [ftsQuery];

    if (options?.nodeTypes && options.nodeTypes.length > 0) {
      const placeholders = options.nodeTypes.map(() => "?").join(",");
      sql += ` AND n.node_type IN (${placeholders})`;
      params.push(...options.nodeTypes);
    }

    if (options?.scopePrefix) {
      sql += " AND n.feature_path LIKE ? || '%'";
      params.push(options.scopePrefix);
    }

    sql += " ORDER BY rank LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      node: this.parseNode(row),
      score: Math.abs(row.score as number),
    }));
  }

  // ---------------------------------------------------------------------------
  // Tree queries
  // ---------------------------------------------------------------------------

  getChildren(parentId: string): ArborNode[] {
    const rows = this.db.prepare("SELECT * FROM nodes WHERE parent_id = ?").all(parentId) as Record<
      string,
      unknown
    >[];

    return rows.map((row) => this.parseNode(row));
  }

  // ---------------------------------------------------------------------------
  // Graph meta
  // ---------------------------------------------------------------------------

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM graph_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;

    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO graph_meta (key, value) VALUES (?, ?)").run(key, value);
  }

  // ---------------------------------------------------------------------------
  // Transaction
  // ---------------------------------------------------------------------------

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseNode(row: Record<string, unknown>): ArborNode {
    return {
      id: row.id as string,
      level: row.level as ArborNode["level"],
      node_type: row.node_type as ArborNode["node_type"],
      feature: row.feature as string,
      features: JSON.parse(row.features as string) as string[],
      metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
      parent_id: (row.parent_id as string) ?? null,
      feature_path: row.feature_path as string,
      created_at: row.created_at as string | undefined,
      updated_at: row.updated_at as string | undefined,
    };
  }

  private parseEdge(row: Record<string, unknown>): ArborEdge {
    return {
      source_id: row.source_id as string,
      target_id: row.target_id as string,
      edge_type: row.edge_type as ArborEdge["edge_type"],
      category: row.category as ArborEdge["category"],
      metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
    };
  }
}
