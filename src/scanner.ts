import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import { ScanContext, Framework } from "./types";

// File name patterns that indicate high-value security targets (Tier 2)
const TIER2_NAME_PATTERNS = /auth|token|key|secret|admin|password|role|stripe|payment|user|session|jwt|oauth/i;

// Directories to always skip
const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", ".cache", "__pycache__", ".the-wall"];

// Tier 1: always scan these globs
const TIER1_GLOBS = [
  ".env",
  ".env.*",
  "package.json",
  "requirements.txt",
  "Gemfile",
  "Dockerfile",
  ".gitignore",
  ".dockerignore",
  ".npmignore",
  "api/**/*.{ts,js,py,rb}",
  "routes/**/*.{ts,js,py,rb}",
  "middleware/**/*.{ts,js,py,rb}",
  "auth/**/*.{ts,js,py,rb}",
  "src/api/**/*.{ts,js}",
  "src/routes/**/*.{ts,js}",
  "src/middleware/**/*.{ts,js}",
  "src/auth/**/*.{ts,js}",
  "pages/api/**/*.{ts,js}",
  "app/api/**/*.{ts,js}",
  ".github/workflows/*.{yml,yaml}",
  "nginx.conf",
  "nginx/**/*.conf",
  "config/**/*.{ts,js,json}",
];

function isSkippedDir(filePath: string): boolean {
  return SKIP_DIRS.some((d) => filePath.includes(`/${d}/`) || filePath.includes(`\\${d}\\`));
}

function readFileSafe(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 500_000) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Parse .the-wallignore — gitignore-style file with glob patterns.
 * Returns a list of glob patterns to exclude.
 */
function loadIgnorePatterns(root: string): string[] {
  const ignorePath = path.join(root, ".the-wallignore");
  if (!fs.existsSync(ignorePath)) return [];

  const content = fs.readFileSync(ignorePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((pattern) => {
      // Convert to glob ignore format
      if (pattern.startsWith("/")) return `**${pattern}`;
      if (!pattern.includes("/")) return `**/${pattern}`;
      return pattern;
    });
}

export async function scanProject(root: string, framework: Framework): Promise<ScanContext> {
  const files = new Map<string, string>();
  const customIgnores = loadIgnorePatterns(root);
  const allIgnores = [...SKIP_DIRS.map((d) => `**/${d}/**`), ...customIgnores];

  // ── Tier 1: always-scan globs ─────────────────────────────────────────────
  for (const pattern of TIER1_GLOBS) {
    const matches = await glob(pattern, {
      cwd: root,
      absolute: true,
      dot: true,
      ignore: allIgnores,
    });
    for (const match of matches) {
      if (!files.has(match)) {
        const content = readFileSafe(match);
        if (content !== null) files.set(match, content);
      }
    }
  }

  // ── Tier 2: name-pattern-matched source files ──────────────────────────────
  const allSrc = await glob("src/**/*.{ts,js,tsx,jsx,py,rb}", {
    cwd: root,
    absolute: true,
    ignore: allIgnores,
  });

  for (const match of allSrc) {
    if (isSkippedDir(match)) continue;
    const basename = path.basename(match);
    if (TIER2_NAME_PATTERNS.test(basename) && !files.has(match)) {
      const content = readFileSafe(match);
      if (content !== null) files.set(match, content);
    }
  }

  // ── Load special files for structured checks ──────────────────────────────
  const readSpecial = (name: string) => {
    const p = path.join(root, name);
    return fs.existsSync(p) ? readFileSafe(p) ?? undefined : undefined;
  };

  let packageJson: Record<string, unknown> | undefined;
  const pkgRaw = readSpecial("package.json");
  if (pkgRaw) {
    try { packageJson = JSON.parse(pkgRaw); } catch { /* ignore */ }
  }

  const hasLockFile =
    fs.existsSync(path.join(root, "package-lock.json")) ||
    fs.existsSync(path.join(root, "yarn.lock")) ||
    fs.existsSync(path.join(root, "pnpm-lock.yaml"));

  const isGitRepo = fs.existsSync(path.join(root, ".git"));

  return {
    root,
    framework,
    files,
    packageJson,
    gitignoreContent: readSpecial(".gitignore"),
    dockerignoreContent: readSpecial(".dockerignore"),
    dockerfileContent: readSpecial("Dockerfile"),
    hasLockFile,
    isGitRepo,
  };
}
