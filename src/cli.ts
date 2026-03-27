#!/usr/bin/env node

import minimist from "minimist";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import { ScanOptions, Severity } from "./types";
import { detectFramework } from "./detector";
import { scanProject } from "./scanner";
import { runEngine } from "./engine";
import { printReport, printCiSummary } from "./reporter";
import { resolveApiKey } from "./config";
import { runConfigWizard } from "./configure";
import { runSafeInstall } from "./install";

const VALID_SEVERITIES: Severity[] = ["critical", "high", "medium", "info"];
const VERSION = "0.2.2";

const BANNER = `
${chalk.bold.white("⚔️  THE WALL")}  ${chalk.dim(`v${VERSION}`)}
${chalk.dim("The Wall between AI-generated code and production.")}
${chalk.dim("The code is dark and full of terrors.")}
`;

function printHelp(): void {
  console.log(`
${chalk.bold.white("⚔️  THE WALL")} v${VERSION}
${chalk.dim("The Wall between AI-generated code and production.")}
${chalk.dim("The code is dark and full of terrors.")}

${chalk.bold("USAGE")}
  ${chalk.cyan("npx @dog-verao/the-wall")} [command] [options]

${chalk.bold("COMMANDS")}
  ${chalk.cyan("scan")}                    Security scan (default if no command given)
  ${chalk.cyan("install <pkg> [...]")}     Safe npm install — detects typosquatting & suspicious packages
  ${chalk.cyan("--config")}                Interactive AI key setup

${chalk.bold("SCAN OPTIONS")}
  ${chalk.cyan("--path <dir>")}            Path to project root (default: current directory)
  ${chalk.cyan("--ai")}                    Enable AI-powered deep analysis
  ${chalk.cyan("--provider <name>")}       AI provider: openai | anthropic (default: auto-detect)
  ${chalk.cyan("--key <api-key>")}         API key (overrides config and env)
  ${chalk.cyan("--budget <cents>")}        Max AI spend in cents (default: 50)
  ${chalk.cyan("--ci")}                    CI mode: exit 1 on blocking findings
  ${chalk.cyan("--fail-on <level>")}       Failure threshold: critical|high|medium (default: critical)

${chalk.bold("CONFIG")}
  ${chalk.cyan("--config")}                Interactive AI key setup (global)
  ${chalk.cyan("--config --local")}        Save API key to project .env

${chalk.bold("OTHER")}
  ${chalk.cyan("--version")}               Show version
  ${chalk.cyan("--help")}                  Show this help

${chalk.bold("EXAMPLES")}
  ${chalk.dim("# Scan current project")}
  npx @dog-verao/the-wall

  ${chalk.dim("# Safe install a package")}
  npx @dog-verao/the-wall install some-ai-suggested-pkg

  ${chalk.dim("# First-time AI setup")}
  npx @dog-verao/the-wall --config

  ${chalk.dim("# Scan with AI deep analysis")}
  npx @dog-verao/the-wall --ai

  ${chalk.dim("# CI gate")}
  npx @dog-verao/the-wall --ci --fail-on=critical

  ${chalk.dim("# Scan with AI budget cap")}
  npx @dog-verao/the-wall --ai --budget=25
`);
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    string: ["path", "key", "fail-on", "provider", "budget"],
    boolean: ["ai", "ci", "verbose", "help", "version", "config", "local", "yes"],
    alias: { h: "help", v: "version", p: "path", k: "key", y: "yes" },
    default: { "fail-on": "critical", budget: "50" },
    stopEarly: false,
  });

  if (argv.version) {
    console.log(`the-wall v${VERSION}`);
    process.exit(0);
  }

  if (argv.help) {
    printHelp();
    process.exit(0);
  }

  // ── Check for subcommand ────────────────────────────────────────────────
  const command = argv._[0] as string | undefined;

  // ── install subcommand ──────────────────────────────────────────────────
  if (command === "install" || command === "i") {
    const packages = argv._.slice(1) as string[];
    if (packages.length === 0) {
      console.error(chalk.red("\n  ✗ Please specify packages to install: the-wall install <pkg> [...]\n"));
      process.exit(1);
    }
    await runSafeInstall(packages, { yes: Boolean(argv.yes) });
    process.exit(0);
  }

  // ── Resolve project root ───────────────────────────────────────────────
  const rawPath = (argv.path as string | undefined) ?? process.cwd();
  const projectRoot = path.resolve(rawPath);

  if (!fs.existsSync(projectRoot)) {
    console.error(chalk.red(`\n  ✗ Path not found: ${projectRoot}\n`));
    process.exit(1);
  }

  // ── --config mode ─────────────────────────────────────────────────────
  if (argv.config) {
    await runConfigWizard(projectRoot, Boolean(argv.local));
    process.exit(0);
  }

  // ── Validate options ──────────────────────────────────────────────────
  const failOn = argv["fail-on"] as Severity;
  if (!VALID_SEVERITIES.includes(failOn)) {
    console.error(chalk.red(`\n  ✗ Invalid --fail-on value: "${failOn}". Choose: critical | high | medium | info\n`));
    process.exit(1);
  }

  const budget = parseInt(argv.budget as string, 10);
  if (isNaN(budget) || budget < 0) {
    console.error(chalk.red(`\n  ✗ Invalid --budget value. Provide a number of cents (e.g. --budget=50)\n`));
    process.exit(1);
  }

  // ── Resolve AI key ────────────────────────────────────────────────────
  const rawProvider = argv.provider as string | undefined;
  const validProvider = rawProvider === "anthropic" ? "anthropic" : rawProvider === "openai" ? "openai" : undefined;
  const { apiKey, provider } = resolveApiKey(argv.key as string | undefined, validProvider, projectRoot);

  if (argv.ai && !apiKey) {
    console.error(chalk.red("\n  ✗ --ai requires an API key. Run: ") + chalk.cyan("npx @dog-verao/the-wall --config\n"));
    process.exit(1);
  }

  const opts: ScanOptions = {
    path: projectRoot,
    ai: Boolean(argv.ai),
    ci: Boolean(argv.ci),
    failOn,
    verbose: Boolean(argv.verbose),
    provider: argv.ai ? provider : undefined,
    apiKey: argv.ai ? apiKey : undefined,
    budget: argv.ai ? budget : undefined,
  };

  // ── Run scan ──────────────────────────────────────────────────────────
  console.log(BANNER);
  console.log(chalk.dim(`  Scanning ${projectRoot} …`));

  const framework = detectFramework(projectRoot);
  const ctx = await scanProject(projectRoot, framework);

  if (opts.ai) {
    console.log(chalk.dim(`  Framework: ${framework} | ${ctx.files.size} files | AI: ${provider} | Budget: ${budget}¢`));
  } else {
    console.log(chalk.dim(`  Framework: ${framework} | ${ctx.files.size} files`));
  }

  const report = await runEngine(ctx, {
    ai: opts.ai,
    provider: opts.provider,
    apiKey: opts.apiKey,
    budget: opts.budget,
  });

  // ── Output ────────────────────────────────────────────────────────────
  printReport(report, opts);

  if (opts.ci) {
    printCiSummary(report, opts.failOn);
  }
}

main().catch((err) => {
  console.error(chalk.red("\n  ✗ Unexpected error:"), err instanceof Error ? err.message : err);
  process.exit(1);
});
