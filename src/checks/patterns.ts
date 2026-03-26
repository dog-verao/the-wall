import * as path from "path";
import { Rule, RuleResult, ScanContext } from "../types";

interface SecretPattern {
  pattern: RegExp;
  ruleId: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/, ruleId: "SEC-011" },
  // Stripe live key
  { pattern: /sk_live_[a-zA-Z0-9]{24,}/, ruleId: "SEC-012" },
  // Stripe test key in prod config
  { pattern: /sk_test_[a-zA-Z0-9]{24,}/, ruleId: "PAY-002" },
  // OpenAI
  { pattern: /sk-[A-Za-z0-9]{32,}/, ruleId: "SEC-001" },
  // Generic API key prefixes
  { pattern: /['"][A-Za-z0-9_\-]{20,}['"].*(?:api.?key|apikey|api_key)/i, ruleId: "SEC-001" },
  // Private keys
  { pattern: /BEGIN\s+(RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE KEY/, ruleId: "SEC-006" },
  // Generic DB URL with credentials
  { pattern: /(postgres|mysql|mongodb\+srv):\/\/[^:@\s]+:[^@\s]+@/, ruleId: "SEC-002" },
  // Weak JWT secret literal
  { pattern: /jwt\.sign\([^,]+,\s*['"](?:secret|password|changeme|your.{0,10}secret|12345|keyboard|cat)['"]/i, ruleId: "SEC-009" },
  // Hard-coded password assignment
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}['"]/i, ruleId: "SEC-001" },
  // console.log of sensitive var
  { pattern: /console\.log\([^)]*(?:password|token|secret|passwd)[^)]*\)/i, ruleId: "AUTH-013" },
  // NEXT_PUBLIC env with secret-sounding name
  { pattern: /NEXT_PUBLIC_(?:SECRET|KEY|TOKEN|PASS|PRIVATE)[A-Z_]*\s*=\s*\S+/, ruleId: "SEC-014" },
  // NODE_TLS disabled
  { pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/, ruleId: "HTTP-005" },
  // Dockerfile ENV secret
  { pattern: /^ENV\s+\w*(?:KEY|SECRET|PASSWORD|TOKEN|PASS)\w*\s+\S+/im, ruleId: "SEC-007" },
];

// Regex patterns that should be ABSENT (their presence is the issue)
const INJECTION_PATTERNS: SecretPattern[] = [
  { pattern: /`(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^`]*\$\{|"(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^"]*"\s*\+|'(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^']*'\s*\+/i, ruleId: "INJ-001" },
  { pattern: /\.find\(req\.(body|query|params)\)/, ruleId: "INJ-002" },
  { pattern: /eval\(req\.(body|query|params|.*?)\)/, ruleId: "INJ-003" },
  { pattern: /exec\(`[^`]*\$\{|exec\([^)]*req\./, ruleId: "INJ-004" },
  { pattern: /\.innerHTML\s*=/, ruleId: "INJ-005" },
  { pattern: /dangerouslySetInnerHTML\s*=\s*\{\{/, ruleId: "INJ-006" },
  { pattern: /fs\.(?:readFile|readFileSync)\([^)]*req\./, ruleId: "INJ-007" },
  { pattern: /(?:ejs|pug|nunjucks)\.render\([^)]*req\./, ruleId: "INJ-008" },
  { pattern: /JSON\.parse\(req\./, ruleId: "INJ-009" },
  // Auth patterns
  { pattern: /Math\.random\(\).*(?:token|nonce|salt|secret|otp|code)/i, ruleId: "CRYPTO-001" },
  { pattern: /createHash\(['"]md5['"]\)/, ruleId: "CRYPTO-002" },
  { pattern: /['"]aes-(?:128|192|256)-ecb['"]/, ruleId: "CRYPTO-003" },
  { pattern: /bcrypt\.hash\([^,]+,\s*[1-9]\b/, ruleId: "CRYPTO-004" },
  { pattern: /cors\(\{[^}]*origin:\s*['"]\*['"]/, ruleId: "HTTP-002" },
  { pattern: /localStorage\.setItem\(['"]token['"]/, ruleId: "AUTH-004" },
  { pattern: /jwt\.sign\([^)]+\)(?![\s\S]{0,200}expiresIn)/, ruleId: "AUTH-005" },
  { pattern: /httpOnly\s*:\s*false/, ruleId: "AUTH-006" },
  { pattern: /secure\s*:\s*false/, ruleId: "AUTH-007" },
  { pattern: /(?:console\.log|logger\.(?:info|debug))\([^)]*req\.body/, ruleId: "LOG-001" },
  { pattern: /(?:console\.log|logger\.(?:info|debug))\([^)]*req\.headers/, ruleId: "LOG-002" },
  { pattern: /res\.(?:json|send)\([^)]*(?:err\.stack|err\.message)/, ruleId: "FS-001" },
  { pattern: /['"]User not found['"]|['"]Email not registered['"]|['"]Wrong password['"]|['"]No account['"]/, ruleId: "FS-002" },
  { pattern: /orderBy:\s*req\.|sort:\s*req\./, ruleId: "DB-003" },
  // Payment
  { pattern: /(?:card_number|cvv|cvc|card_cvc).*req\.body/, ruleId: "PAY-003" },
];

function findMatchInLines(content: string, regex: RegExp): { line: number; snippet: string } | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      return { line: i + 1, snippet: lines[i].trim().slice(0, 120) };
    }
  }
  return null;
}

function isEnvFile(filePath: string): boolean {
  return /\.env(\.|$)/.test(path.basename(filePath));
}

function isFrontendFile(filePath: string): boolean {
  const p = filePath.toLowerCase();
  return (
    p.includes("/components/") ||
    p.includes("/pages/") ||
    p.includes("/app/") ||
    p.includes("/public/") ||
    p.endsWith(".jsx") ||
    p.endsWith(".tsx")
  ) && !p.includes("/api/");
}

export function runPatternChecks(
  ctx: ScanContext,
  allRules: Rule[]
): RuleResult[] {
  const results: RuleResult[] = [];
  const ruleMap = new Map(allRules.map((r) => [r.id, r]));
  const firedRules = new Set<string>(); // avoid duplicate findings for same rule

  for (const [filePath, content] of ctx.files) {
    // Skip .env files from injection checks (they're just key=value)
    const skipInjection = isEnvFile(filePath);

    // ── Secret patterns ───────────────────────────────────────────────────
    for (const { pattern, ruleId } of SECRET_PATTERNS) {
      if (firedRules.has(ruleId)) continue;
      const rule = ruleMap.get(ruleId);
      if (!rule) continue;

      const match = findMatchInLines(content, pattern);
      if (match) {
        firedRules.add(ruleId);
        results.push({ rule, passed: false, file: filePath, ...match });
      }
    }

    if (skipInjection) continue;

    // ── Injection / structural patterns ───────────────────────────────────
    for (const { pattern, ruleId } of INJECTION_PATTERNS) {
      if (firedRules.has(ruleId)) continue;
      const rule = ruleMap.get(ruleId);
      if (!rule) continue;

      // Skip frontend-specific rules on backend files and vice versa
      if (ruleId === "AUTH-004" && !isFrontendFile(filePath)) continue;

      const match = findMatchInLines(content, pattern);
      if (match) {
        firedRules.add(ruleId);
        results.push({ rule, passed: false, file: filePath, ...match });
      }
    }
  }

  return results;
}
