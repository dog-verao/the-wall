import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Rule, RuleResult, ScanContext } from "../types";

interface AuditVuln {
  severity: string;
  name: string;
  via: unknown;
}

interface AuditReport {
  vulnerabilities?: Record<string, AuditVuln>;
  metadata?: { vulnerabilities: Record<string, number> };
}

export function runDependencyChecks(
  ctx: ScanContext,
  allRules: Rule[]
): RuleResult[] {
  const results: RuleResult[] = [];
  const ruleMap = new Map(allRules.map((r) => [r.id, r]));

  const pkgPath = path.join(ctx.root, "package.json");
  if (!fs.existsSync(pkgPath)) return results;

  // ── DEP-004: No lockfile ──────────────────────────────────────────────────
  if (!ctx.hasLockFile) {
    const rule = ruleMap.get("DEP-004");
    if (rule) results.push({ rule, passed: false, snippet: "No package-lock.json, yarn.lock, or pnpm-lock.yaml found" });
  }

  // ── DEP-003: Wildcard versions ────────────────────────────────────────────
  if (ctx.packageJson) {
    const pkg = ctx.packageJson as Record<string, Record<string, string>>;
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const wildcards = Object.entries(allDeps)
      .filter(([, v]) => v === "*" || v === "latest")
      .map(([name]) => name);

    if (wildcards.length > 0) {
      const rule = ruleMap.get("DEP-003");
      if (rule) results.push({ rule, passed: false, snippet: `Wildcard versions: ${wildcards.join(", ")}` });
    }

    // ── DEP-005: postinstall fetching from internet ───────────────────────
    const scripts = (pkg.scripts || {}) as Record<string, string>;
    if (scripts.postinstall && /(curl|wget|bash\s+-c)/.test(scripts.postinstall)) {
      const rule = ruleMap.get("DEP-005");
      if (rule) results.push({ rule, passed: false, file: pkgPath, snippet: `postinstall: ${scripts.postinstall.slice(0, 80)}` });
    }
  }

  // ── DEP-001 / DEP-002: npm audit ─────────────────────────────────────────
  try {
    const auditOutput = execSync("npm audit --json --audit-level=info 2>/dev/null", {
      cwd: ctx.root,
      encoding: "utf8",
      timeout: 30000,
    });

    const audit: AuditReport = JSON.parse(auditOutput);
    const meta = audit?.metadata?.vulnerabilities ?? {};

    if ((meta["critical"] ?? 0) > 0) {
      const rule = ruleMap.get("DEP-001");
      if (rule) results.push({
        rule, passed: false,
        snippet: `${meta["critical"]} critical CVE(s) found — run npm audit for details`
      });
    }
    if ((meta["high"] ?? 0) > 0) {
      const rule = ruleMap.get("DEP-002");
      if (rule) results.push({
        rule, passed: false,
        snippet: `${meta["high"]} high severity CVE(s) found — run npm audit for details`
      });
    }
  } catch {
    // npm audit failed or not a node project — skip silently
  }

  return results;
}
