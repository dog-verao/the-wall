<div align="center">
  <h1>⚔️ THE WALL</h1>
  <p><b>The Wall between AI-generated code and production.</b></p>
  <p><i>"The code is dark and full of terrors."</i></p>

  [![Version](https://img.shields.io/npm/v/@dog-verao/the-wall?color=white&label=Version)](https://www.npmjs.com/package/@dog-verao/the-wall)
</div>

---

## 🛡️ What is The Wall?

**The Wall** is a zero-config, developer-first security scanner designed specifically for the era of AI-generated code. It catches common mistakes, security vulnerabilities, and logic flaws that LLMs often overlook—before they hit production.

## 🚀 Quick Start

No installation required. Run it anywhere with `npx`:

```bash
npx @dog-verao/the-wall
```

---

## 🔥 Key Features

### 1. 🔍 Static Security Scanning
Fast, regex-based and AST-aware checks for over 80+ common vulnerabilities, including hardcoded secrets, SQL injection, weak auth patterns, and more.

### 2. 🧠 AI-Powered Deep Analysis
Enable high-confidence logic checks that static analysis can't catch—like IDOR, mass assignment, and business logic flaws.

```bash
npx @dog-verao/the-wall --ai
```

### 3. 📦 Safe Install (`install` command)
Protects you from typosquatting and AI-hallucinated packages. It verifies package age, download counts, and README presence before allowing an install.

```bash
npx @dog-verao/the-wall install some-pkg
```

### 4. ⚡ Intelligent Caching & Budgeting
The Wall caches AI results locally to save you tokens and includes a `--budget` flag to cap your spend.

---

## 🛠️ Usage & Commands

| Command | Description |
|---|---|
| `scan` (default) | Run a full security scan on the current directory |
| `install <pkg>` | Securely install a package with typosquatting checks |
| `--config` | Interactive wizard to set up your OpenAI/Anthropic keys |
| `--ci` | CI mode: exit with code 1 if critical issues are found |

### Options

- `--path <dir>`: Target directory to scan (default: `.`)
- `--ai`: Enable AI-powered deep checks (requires API key)
- `--budget <cents>`: Cap AI spending in USD cents (default: `50`)
- `--fail-on <severity>`: CI failure threshold (`critical`, `high`, `medium`)
- `--verbose`: Show all findings, including informational ones

---

## 🏰 Configuration

You can provide your API keys through environment variables or a global config file.

```bash
# Set up via interactive wizard
npx @dog-verao/the-wall --config

# Or use environment variables
export THEWALL_API_KEY=your_key_here
```

### `.the-wallignore`
Create a `.the-wallignore` file in your root to exclude specific files or directories from scanning using standard gitignore syntax.

---

## 🏗️ Developer Setup

If you want to contribute or run the project from source:

1. **Clone the repo:**
   ```bash
   git clone https://github.com/dog-verao/security-checker.git
   cd security-checker
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Run locally:**
   ```bash
   node dist/cli.js --path /path/to/project
   ```

---

## 🛡️ CI/CD Integration

The Wall is designed to hold the line in your CI/CD pipeline.

```yaml
# Example GitHub Action step
- name: Run The Wall
  run: npx @dog-verao/the-wall --ci --fail-on=high
  env:
    THEWALL_API_KEY: ${{ secrets.THEWALL_API_KEY }}
```

---

<div align="center">
  <p>Built with ⚔️ by the <b>Dog Verao</b> team.</p>
  <p><i>"The night is dark. Use AI for deep analysis."</i></p>
</div>
