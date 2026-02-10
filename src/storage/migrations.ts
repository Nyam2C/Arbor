import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    -- ============================================================
    -- nodes table
    -- ============================================================
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL CHECK (level IN ('branch', 'leaf')),
      node_type TEXT NOT NULL,
      feature TEXT NOT NULL,
      features TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      parent_id TEXT,
      feature_path TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE SET NULL
    );

    -- ============================================================
    -- nodes_fts — FTS5 virtual table for full-text search
    -- ============================================================
    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
      id, feature, features, feature_path,
      content=nodes, content_rowid=rowid
    );

    -- ============================================================
    -- FTS5 sync triggers
    -- ============================================================
    CREATE TRIGGER IF NOT EXISTS nodes_fts_insert
    AFTER INSERT ON nodes
    BEGIN
      INSERT INTO nodes_fts(rowid, id, feature, features, feature_path)
      VALUES (new.rowid, new.id, new.feature, new.features, new.feature_path);
    END;

    CREATE TRIGGER IF NOT EXISTS nodes_fts_update
    AFTER UPDATE ON nodes
    BEGIN
      INSERT INTO nodes_fts(nodes_fts, rowid, id, feature, features, feature_path)
      VALUES('delete', old.rowid, old.id, old.feature, old.features, old.feature_path);
      INSERT INTO nodes_fts(rowid, id, feature, features, feature_path)
      VALUES (new.rowid, new.id, new.feature, new.features, new.feature_path);
    END;

    CREATE TRIGGER IF NOT EXISTS nodes_fts_delete
    AFTER DELETE ON nodes
    BEGIN
      INSERT INTO nodes_fts(nodes_fts, rowid, id, feature, features, feature_path)
      VALUES('delete', old.rowid, old.id, old.feature, old.features, old.feature_path);
    END;

    -- ============================================================
    -- edges table
    -- ============================================================
    CREATE TABLE IF NOT EXISTS edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('growth', 'root', 'knowledge')),
      metadata TEXT DEFAULT '{}',
      PRIMARY KEY (source_id, target_id, edge_type),
      FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- graph_meta table
    -- ============================================================
    CREATE TABLE IF NOT EXISTS graph_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- ============================================================
    -- Indexes
    -- ============================================================
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type);
    CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_feature_path ON nodes(feature_path);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_edges_category ON edges(category);

    -- ============================================================
    -- Schema version
    -- ============================================================
    INSERT OR IGNORE INTO graph_meta (key, value) VALUES ('schema_version', '1');
  `);
}
