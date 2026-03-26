import * as fs from "fs";
import * as path from "path";
import { Framework } from "./types";

export function detectFramework(root: string): Framework {
  const pkgPath = path.join(root, "package.json");
  const requirementsPath = path.join(root, "requirements.txt");
  const gemfilePath = path.join(root, "Gemfile");

  // Python projects
  if (fs.existsSync(requirementsPath)) {
    const req = fs.readFileSync(requirementsPath, "utf8").toLowerCase();
    if (req.includes("fastapi")) return "fastapi";
    if (req.includes("django")) return "django";
  }

  // Ruby
  if (fs.existsSync(gemfilePath)) return "rails";

  // Node/JS projects — read package.json deps
  if (!fs.existsSync(pkgPath)) return "unknown";

  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return "unknown";
  }

  const deps = {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };

  if (deps["next"]) return "nextjs";
  if (deps["nuxt"] || deps["nuxt3"]) return "nuxt";
  if (deps["@remix-run/node"] || deps["@remix-run/react"]) return "remix";
  if (deps["@nestjs/core"]) return "nestjs";
  if (deps["fastify"]) return "fastify";
  if (deps["express"]) return "express";

  return "unknown";
}
