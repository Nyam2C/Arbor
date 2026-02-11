#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import { ArborStore } from "./storage/sqlite-store.js";
import { loadConfig, saveConfig, ensureArborDir } from "./config.js";
import { startServer } from "./server.js";

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`
arbor v${VERSION} — A tree that remembers your codebase

Usage:
  arbor <command> [options]

Commands:
  init      Initialize .arbor/ directory and graph.db
  serve     Start the MCP server (Phase 1)
  status    Show graph status (Phase 1)
  update    Incremental update from git diff (Phase 5)

Options:
  --help    Show this help message
  --reset   (init) Delete existing DB and recreate
`);
}

function cmdInit(projectRoot: string, reset: boolean): void {
  const arborDir = path.resolve(projectRoot, ".arbor");
  const dbPath = path.resolve(projectRoot, ".arbor", "graph.db");

  if (fs.existsSync(dbPath) && !reset) {
    console.log(`⚠ .arbor/graph.db already exists. Use --reset to recreate.`);
    return;
  }

  if (reset && fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    // Remove WAL/SHM files if present
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    console.log("♻ Existing database removed.");
  }

  ensureArborDir(projectRoot);

  const store = new ArborStore(dbPath);
  store.setMeta("project_root", projectRoot);

  // Root sentinel 노드 생성
  store.upsertNode({
    id: "root",
    level: "branch",
    node_type: "functional_area",
    feature: "Root",
    features: [],
    metadata: {},
    parent_id: null,
    feature_path: "",
  });

  store.close();

  const config = loadConfig(projectRoot);
  saveConfig(projectRoot, config);

  console.log(`✓ Initialized Arbor in ${arborDir}`);
  console.log(`  Database: ${dbPath}`);
}

async function cmdServe(projectRoot: string): Promise<void> {
  const config = loadConfig(projectRoot);
  const dbPath = path.resolve(projectRoot, config.dbPath);

  if (!fs.existsSync(dbPath)) {
    console.error("Error: .arbor/graph.db not found. Run 'arbor init' first.");
    process.exit(1);
  }

  const store = new ArborStore(dbPath);
  await startServer(store);
}

function cmdStatus(): void {
  console.log("arbor status: Phase 1에서 구현 예정.");
}

function cmdUpdate(): void {
  console.log("arbor update: Phase 5에서 구현 예정.");
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  const projectRoot = process.cwd();
  const flags = new Set(args.slice(1));

  switch (command) {
    case "init":
      cmdInit(projectRoot, flags.has("--reset"));
      break;
    case "serve":
      cmdServe(projectRoot);
      break;
    case "status":
      cmdStatus();
      break;
    case "update":
      cmdUpdate();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main();
