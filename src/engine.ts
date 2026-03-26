import chalk from "chalk";
import { Rule, RuleResult, ScanContext, Report, AIProvider, Severity } from "./types";
import { runPatternChecks } from "./checks/patterns";
import { runGitChecks } from "./checks/git";
import { runDependencyChecks } from "./checks/dependencies";
import { runFilesystemChecks } from "./checks/filesystem";
import { runLLMChecks } from "./ai/runner";
import { getDefaultModel } from "./ai/client";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const communityData = require("./rules/rules-community.json") as { rules: Rule[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const proData = require("./rules/rules-pro.json") as { rules: Rule[] };

const COMMUNITY_RULES: Rule[] = communityData.rules;
const PRO_RULES: Rule[] = proData.rules;
const ALL_RULES: Rule[] = [...COMMUNITY_RULES, ...PRO_RULES];

const STATIC_RULES = COMMUNITY_RULES; // Community tier is the static engine
const LLM_RULES = PRO_RULES;          // Pro tier is the AI engine

// ── Confidence downgrading ────────────────────────────────────────────────────
// Files matching these patterns have findings auto-downgraded by one severity level
const LOW_CONFIDENCE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /test\//i,
  /tests\//i,
  /fixtures?\//i,
  /mocks?\//i,
  /\.stories\.[jt]sx?$/,
  /\.example\.[jt]sx?$/,
  /docs?\//i,
  /examples?\//i,
  /demo\//i,
  /seed\//i,
  /scripts?\//i,
];

const DOWNGRADE_MAP: Record<Severity, Severity> = {
  critical: "high",
  high: "medium",
  medium: "info",
  info: "info",
};

function shouldDowngrade(filePath: string | undefined, root: string): boolean {
  if (!filePath) return false;
  const rel = path.relative(root, filePath);
  return LOW_CONFIDENCE_PATTERNS.some((p) => p.test(rel));
}

function applyConfidenceDowngrading(results: RuleResult[], root: string): RuleResult[] {
  return results.map((r) => {
    if (r.file && shouldDowngrade(r.file, root)) {
      return {
        ...r,
        rule: { ...r.rule, severity: DOWNGRADE_MAP[r.rule.severity] },
        downgraded: true,
      };
    }
    return r;
  });
}

export interface EngineOptions {
  ai?: boolean;
  provider?: AIProvider;
  apiKey?: string;
  model?: string;
  budget?: number;
}

export async function runEngine(ctx: ScanContext, opts: EngineOptions = {}): Promise<Report> {
  const start = Date.now();
  let allResults: RuleResult[] = [];
  let aiSpentCents: number | undefined;

  // ── Static checks ─────────────────────────────────────────────────────────
  allResults.push(...runPatternChecks(ctx, STATIC_RULES));
  allResults.push(...(await runGitChecks(ctx, STATIC_RULES)));
  allResults.push(...runDependencyChecks(ctx, STATIC_RULES));
  allResults.push(...runFilesystemChecks(ctx, STATIC_RULES));

  // ── AI checks (opt-in) ────────────────────────────────────────────────────
  if (opts.ai && opts.apiKey && opts.provider) {
    const total = LLM_RULES.length;
    process.stdout.write(chalk.dim(`\n  Running AI analysis (0/${total} rules)…`));

    const aiResult = await runLLMChecks(
      ctx,
      LLM_RULES,
      opts.provider,
      opts.apiKey,
      opts.model ?? getDefaultModel(opts.provider),
      opts.budget ?? 50,
      (current, total, ruleId) => {
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);
        process.stdout.write(chalk.dim(`  Running AI analysis (${current}/${total} rules — ${ruleId})…`));
      }
    );

    process.stdout.clearLine?.(0);
    process.stdout.cursorTo?.(0);
    process.stdout.write(chalk.dim(`  ✓ AI analysis complete — ${aiResult.results.length} finding(s), ${aiResult.spentCents.toFixed(1)}¢\n`));

    allResults.push(...aiResult.results);
    aiSpentCents = aiResult.spentCents;
  }

  // ── Confidence downgrading (test/doc files) ──────────────────────────────
  allResults = applyConfidenceDowngrading(allResults, ctx.root);

  // ── Deduplicate by rule ID ────────────────────────────────────────────────
  const seen = new Set<string>();
  const deduplicated = allResults.filter((r) => {
    if (seen.has(r.rule.id)) return false;
    seen.add(r.rule.id);
    return true;
  });

  return {
    framework: ctx.framework,
    results: deduplicated,
    filesScanned: ctx.files.size,
    duration: Date.now() - start,
    aiSpentCents,
  };
}
