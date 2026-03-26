/**
 * LLM rule runner with caching and budget control.
 *
 * New competitive features:
 *  1. Batched AI analysis — Processes all rules in a single API call for ~95% token efficiency.
 *  2. LLM response caching — ~/.the-wall/cache/llm-cache.json with 7-day TTL.
 *  3. Budget cap — stops AI checks when estimated cost exceeds --budget cents.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import chalk from "chalk";
import { Rule, RuleResult, ScanContext, AIProvider } from "../types";
import { callAI } from "./client";
import { getCacheDir } from "../config";

const MAX_FILE_CHARS = 8000;
const MAX_FILES_PER_BATCH = 8;

// ── Cost estimation (per 1K tokens in USD cents) ─────────────────────────────
const COST_PER_1K_INPUT: Record<string, number> = {
  "gpt-4o-mini": 0.015,        // $0.15 / 1M → 0.015¢/1K
  "claude-3-haiku-20240307": 0.025, // $0.25 / 1M → 0.025¢/1K
};
const COST_PER_1K_OUTPUT: Record<string, number> = {
  "gpt-4o-mini": 0.06,
  "claude-3-haiku-20240307": 0.125,
};

// ── LLM Cache ────────────────────────────────────────────────────────────────
interface CacheEntry {
  hash: string;
  result: BatchFinding[];
  timestamp: number;
}

interface CacheStore {
  version: number;
  entries: Record<string, CacheEntry>;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCachePath(): string {
  return path.join(getCacheDir(), "llm-cache.json");
}

function loadCache(): CacheStore {
  const cachePath = getCachePath();
  try {
    if (!fs.existsSync(cachePath)) return { version: 1, entries: {} };
    return JSON.parse(fs.readFileSync(cachePath, "utf8")) as CacheStore;
  } catch {
    return { version: 1, entries: {} };
  }
}

function saveCache(cache: CacheStore): void {
  try {
    const dir = path.dirname(getCachePath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getCachePath(), JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // Silently fail if we can't write cache
  }
}

function hashPrompt(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

// ── File relevance scoring ───────────────────────────────────────────────────
const TAG_FILE_PATTERNS: Record<string, RegExp> = {
  auth:          /auth|login|session|jwt|token|oauth|password|register|signup/i,
  authorization: /auth|middleware|guard|rbac|role|permission|policy/i,
  idor:          /route|api|controller|handler|endpoint/i,
  "business-logic": /order|payment|checkout|cart|subscription|invoice|billing/i,
  payment:       /stripe|payment|checkout|billing|invoice|price/i,
  webhooks:      /webhook|event|callback/i,
  "multi-tenancy": /tenant|org|organization|team|workspace/i,
  injection:     /route|api|controller|query|db|database/i,
  ssrf:          /fetch|axios|request|http|url|proxy/i,
  "ai-security": /openai|anthropic|llm|ai|gpt|prompt|completion/i,
  oauth:         /oauth|callback|redirect|authorize/i,
  privacy:       /user|profile|data|export|gdpr/i,
};

function scoreFileForRules(filePath: string, rules: Rule[]): number {
  const basename = path.basename(filePath).toLowerCase();
  let maxScore = 0;
  for (const rule of rules) {
    let currentScore = 0;
    for (const tag of rule.tags) {
      const pattern = TAG_FILE_PATTERNS[tag];
      if (pattern && pattern.test(basename)) currentScore += 2;
      if (pattern && pattern.test(filePath)) currentScore += 1;
    }
    if (currentScore > maxScore) maxScore = currentScore;
  }
  return maxScore;
}

function selectFilesForBatch(ctx: ScanContext, rules: Rule[]): Array<[string, string]> {
  const scored: Array<[string, string, number]> = [];

  for (const [filePath, content] of ctx.files) {
    const basename = path.basename(filePath);
    if (basename === "package.json" || basename.startsWith(".env")) continue;
    const score = scoreFileForRules(filePath, rules);
    if (score > 0) scored.push([filePath, content, score]);
  }

  scored.sort((a, b) => b[2] - a[2]);
  return scored.slice(0, MAX_FILES_PER_BATCH).map(([p, c]) => [p, c]);
}

function buildBatchPrompt(ctx: ScanContext, rules: Rule[], files: Array<[string, string]>): string {
  const root = ctx.root;
  const fileBlocks = files
    .map(([filePath, content], idx) => {
      const rel = path.relative(root, filePath);
      const truncated = content.length > MAX_FILE_CHARS
        ? content.slice(0, MAX_FILE_CHARS) + "\n... [truncated]"
        : content;
      return `### File F${idx + 1}: ${rel}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join("\n\n");

  const ruleBlocks = rules
    .map((rule) => {
      return `- ID: ${rule.id}\n  Rule: ${rule.name}\n  Check: ${rule.prompt ?? rule.message}`;
    })
    .join("\n\n");

  return [
    `Project framework: ${ctx.framework}`,
    "",
    "## CONTEXT FILES",
    fileBlocks,
    "",
    "## SECURITY RULES TO CHECK",
    ruleBlocks,
    "",
    "Respond ONLY with a JSON array of findings:",
    `[ { "ruleId": "...", "fileId": "F1", "explanation": "Why this is a real issue..." }, ... ]`,
    "",
    "If a rule does not match any file or no issue is found, do NOT include it in the array.",
    "Only include high-confidence findings.",
  ].join("\n");
}

const SYSTEM_PROMPT = `You are a senior application security engineer performing a batched security code review.
Analyze multiple rules against the provided files. Be conservative: only flag real, actionable issues. 
Respond with valid JSON array only. Do not wrap in markdown.`;

interface BatchFinding {
  ruleId: string;
  fileId: string;
  explanation: string;
}

function parseBatchResponse(raw: string): BatchFinding[] {
  try {
    const clean = raw.replace(/```(?:json)?\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const inCost = (inputTokens / 1000) * (COST_PER_1K_INPUT[model] ?? 0.02);
  const outCost = (outputTokens / 1000) * (COST_PER_1K_OUTPUT[model] ?? 0.08);
  return inCost + outCost;
}

export interface LLMCheckResult {
  results: RuleResult[];
  spentCents: number;
}

export async function runLLMChecks(
  ctx: ScanContext,
  allRules: Rule[],
  provider: AIProvider,
  apiKey: string,
  model: string,
  budgetCents: number,
  onProgress?: (current: number, total: number, ruleId: string) => void
): Promise<LLMCheckResult> {
  const llmRules = allRules.filter((r) => r.type === "llm");
  const results: RuleResult[] = [];
  let spentCents = 0;

  if (llmRules.length === 0) return { results: [], spentCents: 0 };

  // Load LLM cache
  const cache = loadCache();
  const now = Date.now();

  // Select files for the entire batch
  const relevantFiles = selectFilesForBatch(ctx, llmRules);
  if (relevantFiles.length === 0) return { results: [], spentCents: 0 };

  const userPrompt = buildBatchPrompt(ctx, llmRules, relevantFiles);
  const promptHash = hashPrompt(userPrompt);

  // ── Check cache ──────────────────────────────────────────────────────
  const cached = cache.entries[promptHash];
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    process.stdout.write(chalk.dim(` (cached batch hit)`));
    return {
      results: mapFindingsToResults(cached.result, llmRules, relevantFiles),
      spentCents: 0,
    };
  }

  // ── Budget Check ─────────────────────────────────────────────────────
  // Simple heuristic: 1 token per 4 chars
  const estimatedInputTokens = userPrompt.length / 4;
  const estimatedCost = (estimatedInputTokens / 1000) * (COST_PER_1K_INPUT[model] ?? 0.02);
  
  if (estimatedCost > budgetCents) {
    console.error(chalk.yellow(`\n  ⚠ Batch cost estimation (${estimatedCost.toFixed(2)}¢) exceeds budget (${budgetCents}¢). Skipping AI checks.`));
    return { results: [], spentCents: 0 };
  }

  onProgress?.(1, 1, "batch-analysis");

  // ── Call AI ──────────────────────────────────────────────────────────
  try {
    const response = await callAI(
      provider,
      apiKey,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model
    );

    const parsed = parseBatchResponse(response.content);

    // Update cost
    spentCents = estimateCost(response.inputTokens, response.outputTokens, model);

    // Save to cache
    cache.entries[promptHash] = {
      hash: promptHash,
      result: parsed,
      timestamp: now,
    };

    // Purge expired cache entries and save
    for (const [key, entry] of Object.entries(cache.entries)) {
      if ((now - entry.timestamp) > CACHE_TTL_MS) {
        delete cache.entries[key];
      }
    }
    saveCache(cache);

    return {
      results: mapFindingsToResults(parsed, llmRules, relevantFiles),
      spentCents,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("401") || msg.includes("Invalid API key")) {
      console.error(chalk.red(`\n  ✗ AI API authentication failed. Run: npx the-wall --config\n`));
    } else {
      console.error(chalk.red(`\n  ✗ AI Batch analysis failed: ${msg}\n`));
    }
    return { results: [], spentCents: 0 };
  }
}

function mapFindingsToResults(
  findings: BatchFinding[],
  rules: Rule[],
  files: Array<[string, string]>
): RuleResult[] {
  const results: RuleResult[] = [];
  
  for (const finding of findings) {
    const rule = rules.find(r => r.id === finding.ruleId);
    if (!rule) continue;

    const fileIdx = parseInt(finding.fileId.replace("F", ""), 10) - 1;
    const fileTuple = files[fileIdx];
    if (!fileTuple) continue;

    results.push({
      rule,
      passed: false,
      file: fileTuple[0],
      snippet: finding.explanation.slice(0, 300),
    });
  }

  return results;
}
