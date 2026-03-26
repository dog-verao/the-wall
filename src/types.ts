// Shared TypeScript types for the the-wall rule engine

export type Severity = "critical" | "high" | "medium" | "info";
export type RuleType = "static" | "llm" | "hybrid";
export type PatternType =
  | "regex"
  | "regex-absent"
  | "ast-no-auth-middleware"
  | "ast-no-body-validation"
  | "ast-no-helmet"
  | "ast-no-csrf-middleware"
  | "ast-no-csp"
  | "ast-no-rate-limit"
  | "ast-auth-no-rate-limit"
  | "ast-upload-no-filetype"
  | "ast-upload-no-sizelimit"
  | "ast-no-password-hash"
  | "ast-session-no-store"
  | "ast-no-error-tracker"
  | "ast-stripe-webhook-no-verify"
  | "ast-new-db-client-in-handler"
  | "ast-cookie-no-samesite"
  | "npm-audit-critical"
  | "npm-audit-high"
  | "git-tracked-file"
  | "git-history-scan"
  | "gitignore-entry"
  | "dockerignore-missing-env"
  | "dockerfile-no-user"
  | "static-serves-git"
  | "file-exists";

export interface Rule {
  id: string;
  name: string;
  severity: Severity;
  type: RuleType;
  tags: string[];
  pattern?: string;
  patternType?: PatternType;
  check?: string;
  files?: string[];
  target?: string;
  prompt?: string;
  message: string;
}

export interface RuleResult {
  rule: Rule;
  passed: boolean;
  file?: string;
  line?: number;
  snippet?: string;
  /** true if severity was downgraded (test/doc file) */
  downgraded?: boolean;
}

export type Framework =
  | "nextjs"
  | "express"
  | "fastify"
  | "nestjs"
  | "nuxt"
  | "remix"
  | "django"
  | "fastapi"
  | "rails"
  | "unknown";

export interface ScanContext {
  root: string;
  framework: Framework;
  files: Map<string, string>; // path -> content
  packageJson?: Record<string, unknown>;
  gitignoreContent?: string;
  dockerignoreContent?: string;
  dockerfileContent?: string;
  hasLockFile: boolean;
  isGitRepo: boolean;
}

export type AIProvider = "openai" | "anthropic";

export interface ScanOptions {
  path: string;
  ai: boolean;
  ci: boolean;
  failOn: Severity;
  verbose: boolean;
  provider?: AIProvider;
  apiKey?: string;
  budget?: number;
}

export interface GlobalConfig {
  provider?: AIProvider;
  apiKey?: string;
  model?: string;
}

export interface AIRuleResult {
  ruleId: string;
  passed: boolean;
  file?: string;
  explanation?: string;
}

export interface Report {
  framework: Framework;
  results: RuleResult[];
  filesScanned: number;
  duration: number;
  aiSpentCents?: number;
}
