import chalk from "chalk";
import * as path from "path";
import { Report, RuleResult, Severity, ScanOptions } from "./types";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "info"];

const ICONS: Record<Severity, string> = {
  critical: "🚨",
  high: "⚠️ ",
  medium: "ℹ️ ",
  info: "💡",
};

const LABELS: Record<Severity, string> = {
  critical: "Critical — Fix Before Shipping",
  high: "Should Fix",
  medium: "Good to Know",
  info: "Informational",
};

const COLORS: Record<Severity, chalk.Chalk> = {
  critical: chalk.red.bold,
  high: chalk.yellow.bold,
  medium: chalk.cyan,
  info: chalk.gray,
};

function relPath(root: string, filePath?: string): string {
  if (!filePath) return "";
  return path.relative(root, filePath);
}

function formatResult(result: RuleResult, root: string): string {
  const fileInfo = result.file ? chalk.dim(` [${relPath(root, result.file)}${result.line ? `:${result.line}` : ""}]`) : "";
  const snippet = result.snippet ? chalk.dim(`\n        → ${result.snippet.slice(0, 100)}`) : "";
  const downgraded = result.downgraded ? chalk.dim(" (downgraded — test/doc file)") : "";
  return `    • ${result.rule.name}${downgraded}${fileInfo}${snippet}\n      ${chalk.dim(result.rule.message)}`;
}

export function printReport(report: Report, opts: ScanOptions): void {
  const { results, framework, filesScanned, duration } = report;
  const root = opts.path;

  // Group by severity
  const grouped: Record<Severity, RuleResult[]> = {
    critical: [],
    high: [],
    medium: [],
    info: [],
  };
  for (const r of results) {
    grouped[r.rule.severity].push(r);
  }

  const totalIssues = results.length;
  const hasCritical = grouped.critical.length > 0;

  // ── Header ──────────────────────────────────────────────────────────────
  console.log("\n" + chalk.bold.white("━".repeat(60)));
  console.log(chalk.bold.white("  ⚔️  THE WALL — Security Report"));
  console.log(chalk.bold.white("━".repeat(60)));
  console.log(chalk.dim(`  Framework: ${framework}  |  Files scanned: ${filesScanned}  |  ${duration}ms\n`));

  if (totalIssues === 0) {
    console.log(chalk.green.bold("  ✅  The Wall holds. No issues found.\n"));
    console.log(chalk.dim("  Note: This is a static analysis. Run with --ai for deeper logic checks."));
    console.log(chalk.bold.white("━".repeat(60)) + "\n");
    return;
  }

  // ── Issues by severity ────────────────────────────────────────────────
  for (const severity of SEVERITY_ORDER) {
    const group = grouped[severity];
    if (group.length === 0) continue;

    const color = COLORS[severity];
    const icon = ICONS[severity];
    const label = LABELS[severity];

    console.log(color(`  ${icon}  ${label.toUpperCase()} (${group.length})`));
    console.log(color("  " + "─".repeat(56)));
    for (const result of group) {
      console.log(color(formatResult(result, root)));
    }
    console.log();
  }

  // ── Summary footer ────────────────────────────────────────────────────
  console.log(chalk.bold.white("━".repeat(60)));
  const summaryColor = hasCritical ? chalk.red.bold : chalk.yellow.bold;
  console.log(
    summaryColor(
      `  ${hasCritical ? "🛑" : "⚠️ "}  ${totalIssues} issue${totalIssues !== 1 ? "s" : ""} found` +
        ` (${grouped.critical.length} critical, ${grouped.high.length} high, ${grouped.medium.length} medium)`
    )
  );

  if (report.aiSpentCents !== undefined) {
    console.log(chalk.dim(`  AI cost: ${report.aiSpentCents}¢`));
  }

  if (!opts.ai) {
    console.log(chalk.dim("\n  The night is dark. Use --ai for deeper logic analysis."));
  }
  console.log(chalk.bold.white("━".repeat(60)) + "\n");
}

export function printCiSummary(report: Report, failOn: Severity): void {
  const severityWeight: Record<Severity, number> = { critical: 4, high: 3, medium: 2, info: 1 };
  const threshold = severityWeight[failOn];
  const blocking = report.results.filter((r) => severityWeight[r.rule.severity] >= threshold);

  if (blocking.length > 0) {
    console.log(chalk.red.bold(`\n[the-wall] ❌ ${blocking.length} issue(s) at or above ${failOn} severity — blocking CI\n`));
    process.exit(1);
  } else {
    console.log(chalk.green.bold(`\n[the-wall] ✅ The Wall holds. No blocking issues above "${failOn}".\n`));
    process.exit(0);
  }
}
