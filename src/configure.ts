/**
 * Interactive configuration wizard for `the-wall --config`
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { saveGlobalConfig, getConfigPath } from "./config";
import { AIProvider, GlobalConfig } from "./types";

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 6) + "..." + key.slice(-4);
}

function patchGitignore(projectRoot: string, entry: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${entry}\n`, "utf8");
    return;
  }
  const content = fs.readFileSync(gitignorePath, "utf8");
  if (!content.includes(entry)) {
    fs.appendFileSync(gitignorePath, `\n# the-wall\n${entry}\n`);
  }
}

function writeLocalEnv(projectRoot: string, apiKey: string): void {
  const envPath = path.join(projectRoot, ".env");
  const entry = `THEWALL_API_KEY=${apiKey}`;

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    if (content.includes("THEWALL_API_KEY")) {
      const updated = content.replace(/^THEWALL_API_KEY=.*/m, entry);
      fs.writeFileSync(envPath, updated, "utf8");
    } else {
      fs.appendFileSync(envPath, `\n# the-wall AI key\n${entry}\n`);
    }
  } else {
    fs.writeFileSync(envPath, `# the-wall AI key\n${entry}\n`);
  }

  patchGitignore(projectRoot, ".env");
  patchGitignore(projectRoot, ".env.local");
}

export async function runConfigWizard(projectRoot: string, localMode: boolean): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n" + chalk.bold.white("━".repeat(60)));
  console.log(chalk.bold.white("  ⚔️  THE WALL — Configure AI Analysis"));
  console.log(chalk.bold.white("━".repeat(60)));
  console.log(chalk.dim("  Sets up your API key for --ai deep analysis.\n"));

  console.log(chalk.bold("  Choose your AI provider:"));
  console.log("    " + chalk.cyan("1") + "  OpenAI  (gpt-4o-mini — fast & cheap)");
  console.log("    " + chalk.cyan("2") + "  Anthropic  (claude-3-haiku — excellent reasoning)");
  console.log();

  let providerChoice = await prompt(rl, chalk.bold("  Provider [1]: "));
  providerChoice = providerChoice.trim() || "1";
  const provider: AIProvider = providerChoice === "2" ? "anthropic" : "openai";

  const keyHint =
    provider === "openai"
      ? chalk.dim("  Get yours at platform.openai.com/api-keys → starts with sk-")
      : chalk.dim("  Get yours at console.anthropic.com → starts with sk-ant-");

  console.log("\n" + keyHint);

  const apiKey = await prompt(rl, chalk.bold("  API Key: "));
  const trimmedKey = apiKey.trim();

  if (!trimmedKey) {
    console.log(chalk.red("\n  ✗ No API key provided. Exiting.\n"));
    rl.close();
    return;
  }

  const isOpenAI = trimmedKey.startsWith("sk-") && !trimmedKey.startsWith("sk-ant-");
  const isAnthropic = trimmedKey.startsWith("sk-ant-");

  if (provider === "openai" && !isOpenAI) {
    console.log(chalk.yellow("\n  ⚠  Key doesn't look like an OpenAI key (should start with sk-). Saving anyway."));
  }
  if (provider === "anthropic" && !isAnthropic) {
    console.log(chalk.yellow("\n  ⚠  Key doesn't look like an Anthropic key (should start with sk-ant-). Saving anyway."));
  }

  const storageLabel = localMode
    ? `project .env  (${path.join(projectRoot, ".env")})`
    : `global config (${getConfigPath()})`;

  console.log(`\n  ${chalk.bold("Save location:")} ${chalk.cyan(storageLabel)}`);

  if (localMode) {
    console.log(chalk.dim("  THEWALL_API_KEY will be added to .env and protected by .gitignore"));
  } else {
    console.log(chalk.dim("  Works across all your projects. Never touches your repo."));
  }

  const confirm = await prompt(rl, chalk.bold("\n  Save? [Y/n]: "));
  rl.close();

  if (confirm.trim().toLowerCase() === "n") {
    console.log(chalk.dim("\n  Cancelled.\n"));
    return;
  }

  if (localMode) {
    writeLocalEnv(projectRoot, trimmedKey);
    console.log(chalk.green(`\n  ✅  THEWALL_API_KEY saved to ${path.join(projectRoot, ".env")}`));
    console.log(chalk.green("  ✅  .gitignore updated to protect .env\n"));
  } else {
    const config: GlobalConfig = { provider, apiKey: trimmedKey };
    saveGlobalConfig(config);
    console.log(chalk.green(`\n  ✅  Saved to ${getConfigPath()}`));
  }

  console.log(chalk.bold.white("━".repeat(60)));
  console.log(chalk.bold(`  Provider: ${provider}  |  Key: ${maskKey(trimmedKey)}`));
  console.log(chalk.bold.white("━".repeat(60)));
  console.log(chalk.dim("\n  Run: ") + chalk.cyan("npx @dog-verao/the-wall --ai") + chalk.dim(" to use AI deep analysis\n"));
}
