import fs from "node:fs";
import path from "node:path";

export interface ArborConfig {
  projectRoot: string;
  dbPath: string;
  version: string;
}

const ARBOR_DIR = ".arbor";
const CONFIG_FILE = "config.json";

function getDefaults(projectRoot: string): ArborConfig {
  return {
    projectRoot,
    dbPath: path.join(ARBOR_DIR, "graph.db"),
    version: "0.1.0",
  };
}

export function loadConfig(projectRoot: string): ArborConfig {
  const defaults = getDefaults(projectRoot);
  const configPath = path.resolve(projectRoot, ARBOR_DIR, CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<ArborConfig>;

  return {
    ...defaults,
    ...parsed,
    projectRoot,
  };
}

export function saveConfig(projectRoot: string, config: ArborConfig): void {
  const arborDir = path.resolve(projectRoot, ARBOR_DIR);
  fs.mkdirSync(arborDir, { recursive: true });

  const configPath = path.join(arborDir, CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function ensureArborDir(projectRoot: string): string {
  const arborDir = path.resolve(projectRoot, ARBOR_DIR);
  fs.mkdirSync(arborDir, { recursive: true });
  return arborDir;
}
