/**
 * Global config manager for the-wall.
 * Stores API keys in ~/.the-wall/config.json — never in the project repo.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GlobalConfig } from "./types";

const CONFIG_DIR = path.join(os.homedir(), ".the-wall");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const CACHE_DIR = path.join(CONFIG_DIR, "cache");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getCacheDir(): string {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  return CACHE_DIR;
}

export function loadGlobalConfig(): GlobalConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return {};
  }
}

export function saveGlobalConfig(config: GlobalConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Resolve the API key from all sources in priority order:
 * 1. --key CLI flag
 * 2. THEWALL_API_KEY environment variable
 * 3. OPENAI_API_KEY / ANTHROPIC_API_KEY environment variable (convenience)
 * 4. ~/.the-wall/config.json
 * 5. Project .env file (THEWALL_API_KEY=...)
 */
export function resolveApiKey(
  flagKey: string | undefined,
  provider: "openai" | "anthropic" | undefined,
  projectRoot: string
): { apiKey: string | undefined; provider: "openai" | "anthropic" } {
  // 1. CLI flag
  if (flagKey) {
    const p = flagKey.startsWith("sk-ant-") ? "anthropic" : "openai";
    return { apiKey: flagKey, provider: provider ?? p };
  }

  // 2. THEWALL_API_KEY env var
  if (process.env.THEWALL_API_KEY) {
    const k = process.env.THEWALL_API_KEY;
    const p = k.startsWith("sk-ant-") ? "anthropic" : "openai";
    return { apiKey: k, provider: provider ?? p };
  }

  // 3. Provider-specific standard env vars
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return { apiKey: process.env.ANTHROPIC_API_KEY, provider: "anthropic" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { apiKey: process.env.OPENAI_API_KEY, provider: provider ?? "openai" };
  }

  // 4. Global config file
  const global = loadGlobalConfig();
  if (global.apiKey) {
    return { apiKey: global.apiKey, provider: provider ?? global.provider ?? "openai" };
  }

  // 5. Project .env file
  const envPath = path.join(projectRoot, ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    const match = envContent.match(/^THEWALL_API_KEY\s*=\s*(.+)$/m);
    if (match) {
      const k = match[1].trim().replace(/^['"]|['"]$/g, "");
      const p = k.startsWith("sk-ant-") ? "anthropic" : "openai";
      return { apiKey: k, provider: provider ?? p };
    }
  }

  return { apiKey: undefined, provider: provider ?? "openai" };
}
