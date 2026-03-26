import * as path from "path";
import { Rule, RuleResult, ScanContext } from "../types";

export function runFilesystemChecks(
  ctx: ScanContext,
  allRules: Rule[]
): RuleResult[] {
  const results: RuleResult[] = [];
  const ruleMap = new Map(allRules.map((r) => [r.id, r]));

  // ── FS-004: Dockerfile runs as root ──────────────────────────────────────
  if (ctx.dockerfileContent) {
    const dockerRule = ruleMap.get("FS-004");
    if (dockerRule && !/^USER\s+\w/im.test(ctx.dockerfileContent)) {
      results.push({ rule: dockerRule, passed: false, file: path.join(ctx.root, "Dockerfile"), snippet: "No USER directive found in Dockerfile" });
    }

    // ── SEC-007: Secret in Dockerfile ENV ─────────────────────────────────
    const envSecretPattern = /^ENV\s+\w*(?:KEY|SECRET|PASSWORD|TOKEN|PASS)\w*\s+\S+/im;
    const secretRule = ruleMap.get("SEC-007");
    if (secretRule && envSecretPattern.test(ctx.dockerfileContent)) {
      const line = ctx.dockerfileContent.split("\n").find((l) => envSecretPattern.test(l));
      results.push({ rule: secretRule, passed: false, file: path.join(ctx.root, "Dockerfile"), snippet: line?.trim() });
    }
  }

  // ── FS-005 / SEC-005 via docker: .env not in .dockerignore ───────────────
  const dockerignoreRule = ruleMap.get("FS-005");
  if (dockerignoreRule && ctx.dockerfileContent) {
    if (!ctx.dockerignoreContent || !/^\.env/m.test(ctx.dockerignoreContent)) {
      results.push({ rule: dockerignoreRule, passed: false, snippet: ".env not excluded in .dockerignore" });
    }
  }

  // ── HTTP-007: X-Powered-By not disabled (Express) ─────────────────────────
  const poweredByRule = ruleMap.get("HTTP-007");
  if (poweredByRule) {
    let found = false;
    for (const [, content] of ctx.files) {
      if (content.includes("disable('x-powered-by')") || content.includes('disable("x-powered-by")')) {
        found = true;
        break;
      }
    }
    // Only flag if express is the framework
    if (!found && ctx.framework === "express") {
      results.push({ rule: poweredByRule, passed: false, snippet: "app.disable('x-powered-by') not found" });
    }
  }

  // ── HTTP-006: No CSP header ───────────────────────────────────────────────
  const cspRule = ruleMap.get("HTTP-006");
  if (cspRule) {
    let found = false;
    for (const [, content] of ctx.files) {
      if (/Content-Security-Policy|contentSecurityPolicy|csp/i.test(content)) {
        found = true;
        break;
      }
    }
    if (!found) {
      results.push({ rule: cspRule, passed: false, snippet: "No Content-Security-Policy header configuration found" });
    }
  }

  // ── HTTP-001: helmet not used ─────────────────────────────────────────────
  const helmetRule = ruleMap.get("HTTP-001");
  if (helmetRule && (ctx.framework === "express" || ctx.framework === "nestjs" || ctx.framework === "fastify")) {
    let found = false;
    for (const [, content] of ctx.files) {
      if (/require\(['"]helmet['"]\)|from ['"]helmet['"]|import helmet/i.test(content)) {
        found = true;
        break;
      }
    }
    if (!found) {
      results.push({ rule: helmetRule, passed: false, snippet: "helmet package not imported anywhere in the project" });
    }
  }

  // ── LOG-003: No error tracking ────────────────────────────────────────────
  const errorTrackerRule = ruleMap.get("LOG-003");
  if (errorTrackerRule) {
    let found = false;
    const trackerPatterns = /['"@](sentry|datadog|rollbar|bugsnag|raygun|honeybadger|airbrake)['"]/i;
    for (const [, content] of ctx.files) {
      if (trackerPatterns.test(content)) { found = true; break; }
    }
    if (!found && ctx.packageJson) {
      const pkg = ctx.packageJson as Record<string, Record<string, string>>;
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (Object.keys(allDeps).some((k) => trackerPatterns.test(k))) found = true;
    }
    if (!found) {
      results.push({ rule: errorTrackerRule, passed: false, snippet: "No error tracking SDK (Sentry, Datadog, etc.) detected" });
    }
  }

  // ── RATE-001: No rate limiting at all ────────────────────────────────────
  const rateRule = ruleMap.get("RATE-001");
  if (rateRule) {
    let found = false;
    for (const [, content] of ctx.files) {
      if (/rate.?limit|express-rate-limit|rateLimit|throttle|slowDown/i.test(content)) {
        found = true;
        break;
      }
    }
    if (!found) {
      results.push({ rule: rateRule, passed: false, snippet: "No rate limiting library detected in any scanned file" });
    }
  }

  // ── PAY-001: Stripe webhook without signature verification ─────────────────
  const stripeRule = ruleMap.get("PAY-001");
  if (stripeRule) {
    for (const [filePath, content] of ctx.files) {
      const isWebhookFile = /webhook|stripe.*event/i.test(filePath) || /stripe.*webhook|webhook.*stripe/i.test(content);
      const hasStripeHandler = /stripe\.(webhooks|Webhooks)/i.test(content);
      if (isWebhookFile && hasStripeHandler && !content.includes("constructEvent")) {
        results.push({ rule: stripeRule, passed: false, file: filePath, snippet: "Stripe webhook handler missing constructEvent() verification" });
        break;
      }
    }
  }

  return results;
}
