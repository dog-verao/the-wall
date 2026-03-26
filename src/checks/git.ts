import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import simpleGit from "simple-git";
import { Rule, RuleResult, ScanContext } from "../types";

// Known secret regex patterns to scan in git history
const GIT_SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /sk_live_[a-zA-Z0-9]{24,}/,
  /sk-[A-Za-z0-9]{32,}/,
  /BEGIN\s+(RSA\s+|OPENSSH\s+)?PRIVATE KEY/,
  /(postgres|mysql|mongodb\+srv):\/\/[^:@\s]+:[^@\s]+@/,
];

export async function runGitChecks(
  ctx: ScanContext,
  allRules: Rule[]
): Promise<RuleResult[]> {
  const results: RuleResult[] = [];
  const ruleMap = new Map(allRules.map((r) => [r.id, r]));

  if (!ctx.isGitRepo) return results;

  const git = simpleGit(ctx.root);

  // ── SEC-003: .env tracked by git ─────────────────────────────────────────
  try {
    const tracked = await git.raw(["ls-files", ".env"]);
    if (tracked.trim()) {
      const rule = ruleMap.get("SEC-003");
      if (rule) results.push({ rule, passed: false, file: path.join(ctx.root, ".env"), snippet: ".env is tracked by Git" });
    }
  } catch { /* not a git repo */ }

  // ── SEC-004: .env.* tracked ───────────────────────────────────────────────
  try {
    const envFiles = await git.raw(["ls-files", "--", ".env.*", ".env.local", ".env.production", ".env.staging"]);
    if (envFiles.trim()) {
      const rule = ruleMap.get("SEC-004");
      if (rule) {
        results.push({ rule, passed: false, snippet: envFiles.trim().split("\n")[0] });
      }
    }
  } catch { /* ignore */ }

  // ── GIT-002: node_modules tracked ────────────────────────────────────────
  try {
    const nmTracked = await git.raw(["ls-files", "--error-unmatch", "node_modules/.keep"]);
    if (nmTracked) {
      const rule = ruleMap.get("GIT-002");
      if (rule) results.push({ rule, passed: false, snippet: "node_modules is tracked" });
    }
  } catch { /* good — not tracked */ }

  // ── SEC-005: .gitignore missing .env entry ────────────────────────────────
  const gitignoreRule = ruleMap.get("SEC-005");
  if (gitignoreRule) {
    if (!ctx.gitignoreContent) {
      results.push({ rule: gitignoreRule, passed: false, snippet: ".gitignore not found" });
    } else if (!/^\.env/m.test(ctx.gitignoreContent)) {
      results.push({ rule: gitignoreRule, passed: false, file: path.join(ctx.root, ".gitignore"), snippet: ".env* not in .gitignore" });
    }
  }

  // ── GIT-001: no .gitignore at all ────────────────────────────────────────
  if (!ctx.gitignoreContent) {
    const rule = ruleMap.get("GIT-001");
    if (rule) results.push({ rule, passed: false, snippet: ".gitignore not found in project root" });
  }

  // ── SEC-015: secrets in git history (shallow scan of .env history) ────────
  try {
    const log = execSync(
      "git log --all --oneline --diff-filter=A -- .env .env.* .env.local .env.production 2>/dev/null",
      { cwd: ctx.root, encoding: "utf8", timeout: 10000 }
    );
    if (log.trim()) {
      const rule = ruleMap.get("SEC-015");
      if (rule) results.push({ rule, passed: false, snippet: `Found in history: ${log.trim().split("\n")[0]}` });
    }
  } catch { /* ignore */ }

  // Bonus: scan recent git diff for leaked secrets
  try {
    const diff = execSync("git log -1 -p --no-merges 2>/dev/null", {
      cwd: ctx.root,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
    });
    for (const pattern of GIT_SECRET_PATTERNS) {
      if (pattern.test(diff)) {
        const rule = ruleMap.get("SEC-015");
        if (rule && !results.find((r) => r.rule.id === "SEC-015")) {
          results.push({ rule, passed: false, snippet: "Secret pattern found in recent commit diff" });
        }
        break;
      }
    }
  } catch { /* ignore */ }

  return results;
}
