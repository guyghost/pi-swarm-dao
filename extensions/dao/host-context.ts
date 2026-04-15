// ============================================================
// pi-swarm-dao — Host Project Context Detection
// ============================================================
// Detects the project context (repo name, language, framework)
// from the host project where the DAO extension is running.
// This is NOT about pi-swarm-dao itself — it's about the project
// the user is working on when they invoke DAO tools.
// ============================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostProjectContext } from "./types.js";

export type { HostProjectContext };

/**
 * Detect the host project context.
 * Uses git, package.json, and file system heuristics.
 * Safe to call from any directory — gracefully degrades.
 */
export const detectHostContext = (): HostProjectContext => {
  const rootDir = process.cwd();

  // Git info
  let repoName = rootDir.split("/").pop() || "unknown";
  let repoOwner = "unknown";
  let branch = "unknown";

  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: rootDir,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();

    // Parse: https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = remote.match(/[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      repoOwner = match[1];
      repoName = match[2];
    }
  } catch {
    // Not a git repo or no remote
  }

  try {
    branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: rootDir,
      encoding: "utf-8",
      timeout: 5_000,
    }).trim() || "unknown";
  } catch {
    // Not a git repo
  }

  // Language & framework detection
  const { language, framework, packageManager } = detectLanguageFramework(rootDir);

  const isSelfRepo = repoName === "pi-swarm-dao";
  const repoSlug = `${repoOwner}/${repoName}`;

  return {
    rootDir,
    repoName,
    repoOwner,
    repoSlug,
    branch,
    language,
    framework,
    packageManager,
    isSelfRepo,
  };
};

/**
 * Format the host context as a compact string for system prompts.
 */
export const formatHostContext = (ctx: HostProjectContext): string => {
  let info = `📁 **Host Project:** ${ctx.repoSlug}\n`;
  info += `   **Root:** ${ctx.rootDir}\n`;
  info += `   **Branch:** ${ctx.branch}\n`;
  info += `   **Language:** ${ctx.language}\n`;
  if (ctx.framework) {
    info += `   **Framework:** ${ctx.framework}\n`;
  }
  if (ctx.packageManager) {
    info += `   **Package Manager:** ${ctx.packageManager}\n`;
  }
  if (ctx.isSelfRepo) {
    info += `   ⚠️ **Self-referential:** DAO is running inside its own repository\n`;
  }
  return info;
};

/**
 * Build a compact context string for inclusion in agent prompts.
 * Agents need to know WHERE they're running to produce relevant analysis.
 */
export const buildAgentHostContext = (ctx: HostProjectContext): string => {
  return `Project: ${ctx.repoSlug} (${ctx.language}${ctx.framework ? `, ${ctx.framework}` : ""}) on branch "${ctx.branch}"`;
};

// ── Detection helpers ────────────────────────────────────────

interface LangFramework {
  language: string;
  framework: string;
  packageManager: string;
}

const detectLanguageFramework = (rootDir: string): LangFramework => {
  // Check for TypeScript/JavaScript
  if (existsSync(join(rootDir, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      let framework = "";
      let packageManager = "npm";

      if (deps["vue"] || deps["nuxt"]) framework = "Vue/Nuxt";
      else if (deps["react"] || deps["next"]) framework = "React/Next";
      else if (deps["svelte"] || deps["@sveltejs/kit"]) framework = "SvelteKit";
      else if (deps["express"] || deps["fastify"]) framework = "Express/Fastify";
      else if (deps["@mariozechner/pi-coding-agent"]) framework = "Pi Extension";
      else if (deps["vitest"] || deps["jest"]) framework = "Testing";

      if (existsSync(join(rootDir, "pnpm-lock.yaml"))) packageManager = "pnpm";
      else if (existsSync(join(rootDir, "yarn.lock"))) packageManager = "yarn";
      else if (existsSync(join(rootDir, "bun.lockb"))) packageManager = "bun";

      const isTS = existsSync(join(rootDir, "tsconfig.json"));
      return {
        language: isTS ? "TypeScript" : "JavaScript",
        framework,
        packageManager,
      };
    } catch {
      return { language: "JavaScript", framework: "", packageManager: "npm" };
    }
  }

  // Check for Rust
  if (existsSync(join(rootDir, "Cargo.toml"))) {
    return { language: "Rust", framework: "Cargo", packageManager: "cargo" };
  }

  // Check for Go
  if (existsSync(join(rootDir, "go.mod"))) {
    return { language: "Go", framework: "", packageManager: "go" };
  }

  // Check for Kotlin/Android
  if (existsSync(join(rootDir, "build.gradle.kts")) || existsSync(join(rootDir, "settings.gradle.kts"))) {
    return { language: "Kotlin", framework: "Gradle", packageManager: "gradle" };
  }

  // Check for Swift/iOS
  if (existsSync(join(rootDir, "Package.swift"))) {
    return { language: "Swift", framework: "SPM", packageManager: "swift" };
  }

  // Check for Python
  if (existsSync(join(rootDir, "pyproject.toml")) || existsSync(join(rootDir, "setup.py"))) {
    return { language: "Python", framework: "", packageManager: "pip" };
  }

  return { language: "Unknown", framework: "", packageManager: "" };
};
