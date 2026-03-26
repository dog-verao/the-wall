/**
 * `the-wall install <pkg>` — Safe npm install wrapper.
 * Checks packages for typosquatting, slopsquatting (AI-hallucinated names),
 * suspiciously new publish dates, and low download counts before installing.
 */

import { execSync } from "child_process";
import * as readline from "readline";
import chalk from "chalk";

interface PackageMeta {
  name: string;
  version: string;
  description?: string;
  time?: Record<string, string>;
  "dist-tags"?: Record<string, string>;
  repository?: { url?: string };
  readme?: string;
  license?: string;
}

interface DownloadCount {
  downloads: number;
  package: string;
}

interface Warning {
  message: string;
  severity: "critical" | "high" | "medium" | "low";
}

// ── Popular package names for Levenshtein comparison ──────────────────────────
const POPULAR_PACKAGES = [
  "express", "react", "next", "vue", "angular", "svelte", "lodash", "axios",
  "moment", "dayjs", "chalk", "commander", "inquirer", "dotenv", "cors",
  "helmet", "jsonwebtoken", "bcrypt", "bcryptjs", "mongoose", "sequelize",
  "prisma", "drizzle-orm", "stripe", "nodemailer", "winston", "pino",
  "jest", "mocha", "vitest", "webpack", "vite", "esbuild", "rollup",
  "tailwindcss", "typescript", "eslint", "prettier", "husky", "zod",
  "yup", "joi", "socket.io", "passport", "multer", "formidable",
  "puppeteer", "playwright", "cheerio", "sharp", "uuid", "nanoid",
  "date-fns", "luxon", "redis", "ioredis", "pg", "mysql2", "better-sqlite3",
  "supabase", "firebase", "aws-sdk", "openai", "langchain",
];

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

function findSimilarPopular(name: string): string | null {
  const stripped = name.replace(/[-_]/g, "").toLowerCase();
  for (const popular of POPULAR_PACKAGES) {
    const popStripped = popular.replace(/[-_]/g, "").toLowerCase();
    if (stripped === popStripped) continue; // exact match
    const dist = levenshtein(stripped, popStripped);
    if (dist === 1 || dist === 2) return popular;
  }
  return null;
}

async function fetchMeta(pkg: string): Promise<PackageMeta | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
    if (!res.ok) return null;
    return (await res.json()) as PackageMeta;
  } catch {
    return null;
  }
}

async function fetchDownloads(pkg: string): Promise<number> {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`);
    if (!res.ok) return 0;
    const data = (await res.json()) as DownloadCount;
    return data.downloads ?? 0;
  } catch {
    return 0;
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function checkPackage(pkg: string): Promise<Warning[]> {
  const warnings: Warning[] = [];

  // 1. Fetch metadata
  const meta = await fetchMeta(pkg);
  if (!meta) {
    warnings.push({ message: `Package "${pkg}" not found on npm registry`, severity: "critical" });
    return warnings;
  }

  // 2. Typosquatting — Levenshtein distance to popular packages
  const similar = findSimilarPopular(pkg);
  if (similar) {
    warnings.push({
      message: `Name "${pkg}" is suspiciously similar to popular package "${similar}" — possible typosquatting`,
      severity: "high",
    });
  }

  // 3. Package age — published in last 30 days
  const latestTag = meta["dist-tags"]?.latest;
  const created = meta.time?.created;
  if (created) {
    const ageMs = Date.now() - new Date(created).getTime();
    const ageDays = Math.floor(ageMs / 86400000);
    if (ageDays < 7) {
      warnings.push({ message: `Published ${ageDays} day(s) ago — extremely new package`, severity: "high" });
    } else if (ageDays < 30) {
      warnings.push({ message: `Published ${ageDays} day(s) ago — relatively new package`, severity: "medium" });
    }
  }

  // 4. Download count — low popularity
  const downloads = await fetchDownloads(pkg);
  if (downloads < 50) {
    warnings.push({ message: `Only ${downloads} weekly downloads — very low adoption`, severity: "high" });
  } else if (downloads < 500) {
    warnings.push({ message: `Only ${downloads} weekly downloads — low adoption`, severity: "medium" });
  }

  // 5. Missing README
  if (!meta.readme || meta.readme.length < 100 || meta.readme.includes("No README")) {
    warnings.push({ message: "Missing or placeholder README", severity: "medium" });
  }

  // 6. No license
  if (!meta.license) {
    warnings.push({ message: "No license specified", severity: "medium" });
  }

  // 7. No repository
  if (!meta.repository?.url) {
    warnings.push({ message: "No linked source repository", severity: "low" });
  }

  return warnings;
}

const SEVERITY_COLORS: Record<string, chalk.Chalk> = {
  critical: chalk.red.bold,
  high: chalk.yellow.bold,
  medium: chalk.cyan,
  low: chalk.gray,
};

export async function runSafeInstall(packages: string[], opts: { yes: boolean }): Promise<void> {
  console.log("\n" + chalk.bold.white("━".repeat(60)));
  console.log(chalk.bold.white("  ⚔️  THE WALL — Safe Install"));
  console.log(chalk.bold.white("━".repeat(60)));

  let blocked = false;

  for (const pkg of packages) {
    console.log(chalk.dim(`\n  Checking "${pkg}"…`));

    const warnings = await checkPackage(pkg);

    if (warnings.length === 0) {
      console.log(chalk.green(`  ✅ "${pkg}" looks safe`));
      continue;
    }

    // Display warnings
    const hasCritical = warnings.some((w) => w.severity === "critical");
    const hasHigh = warnings.some((w) => w.severity === "high");

    console.log(chalk.yellow(`\n  ⚠  Found ${warnings.length} concern(s) for "${pkg}":\n`));
    for (const w of warnings) {
      const color = SEVERITY_COLORS[w.severity] ?? chalk.gray;
      console.log(color(`    ${w.severity.toUpperCase()}: ${w.message}`));
    }

    if (hasCritical) {
      console.log(chalk.red.bold(`\n  🛑 "${pkg}" blocked — package not found on npm`));
      blocked = true;
      continue;
    }

    // Ask for confirmation (unless --yes)
    if (!opts.yes) {
      const answer = await prompt(chalk.bold(`\n  Install "${pkg}" anyway? [y/N]: `));
      if (answer.trim().toLowerCase() !== "y") {
        console.log(chalk.dim(`  Skipped "${pkg}"`));
        blocked = true;
        continue;
      }
    } else if (hasHigh) {
      console.log(chalk.yellow(`  --yes flag set, but high-severity warnings found. Installing anyway.`));
    }
  }

  if (blocked) {
    const safe = packages.filter((p) => !blocked); // simplified — in full version, track per-package
    if (safe.length === 0) {
      console.log(chalk.red.bold("\n  All packages blocked. Nothing installed.\n"));
      return;
    }
  }

  // Actually install
  const safeToInstall = packages; // TODO: filter per-package on full impl
  console.log(chalk.dim(`\n  Running: npm install ${safeToInstall.join(" ")}\n`));

  try {
    execSync(`npm install ${safeToInstall.join(" ")}`, { stdio: "inherit" });
    console.log(chalk.green.bold("\n  ✅ Installation complete\n"));
  } catch {
    console.error(chalk.red("\n  ✗ npm install failed\n"));
  }
}
