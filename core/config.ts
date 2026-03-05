// ─────────────────────────────────────────────────────────────
// AETHER Workspace Scanner & Configuration Manager
// Detects tech stack, generates config, manages .aether/ dir.
// ─────────────────────────────────────────────────────────────

import type {
  WorkspaceProfile,
  AetherConfig,
  ProviderConfig,
  ProviderModelConfig,
  LLMProvider,
} from "./types.ts";
import { SettingsManager } from "./settings.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────
// Workspace Scanner
// ─────────────────────────────────────────────────────────────

export class WorkspaceScanner {
  /**
   * Scan a workspace directory and build a WorkspaceProfile
   * describing its tech stack, package manager, languages, etc.
   */
  static async scan(rootPath: string): Promise<WorkspaceProfile> {
    const profile: WorkspaceProfile = {
      packageManager: "unknown",
      frameworks: [],
      languages: [],
      database: [],
      testFramework: [],
      ide: [],
      llmKeys: [],
      rootPath,
    };

    // ── Package Manager ────────────────────────────────────
    if (await WorkspaceScanner.fileExists(join(rootPath, "bun.lockb"))) {
      profile.packageManager = "bun";
    } else if (await WorkspaceScanner.fileExists(join(rootPath, "bun.lock"))) {
      profile.packageManager = "bun";
    } else if (await WorkspaceScanner.fileExists(join(rootPath, "yarn.lock"))) {
      profile.packageManager = "yarn";
    } else if (
      await WorkspaceScanner.fileExists(join(rootPath, "pnpm-lock.yaml"))
    ) {
      profile.packageManager = "pnpm";
    } else if (
      await WorkspaceScanner.fileExists(join(rootPath, "package-lock.json"))
    ) {
      profile.packageManager = "npm";
    }

    // ── Parse package.json ─────────────────────────────────
    const pkgPath = join(rootPath, "package.json");
    let deps: Record<string, string> = {};
    let devDeps: Record<string, string> = {};

    if (await WorkspaceScanner.fileExists(pkgPath)) {
      try {
        const raw = await Bun.file(pkgPath).text();
        const pkg = JSON.parse(raw);
        deps = pkg.dependencies ?? {};
        devDeps = pkg.devDependencies ?? {};
      } catch {
        // Malformed package.json — skip dependency detection
      }
    }

    const allDeps = { ...deps, ...devDeps };

    // ── Frameworks (from dependencies) ─────────────────────
    const frameworkMap: Record<string, string> = {
      react: "react",
      "react-dom": "react",
      vue: "vue",
      svelte: "svelte",
      "@sveltejs/kit": "sveltekit",
      next: "next",
      nuxt: "nuxt",
      express: "express",
      elysia: "elysia",
      hono: "hono",
      fastify: "fastify",
      koa: "koa",
      "solid-js": "solid",
      angular: "angular",
      "@angular/core": "angular",
      astro: "astro",
      remix: "remix",
      "@remix-run/react": "remix",
      tailwindcss: "tailwind",
      three: "threejs",
      electron: "electron",
      vite: "vite",
    };

    const detectedFrameworks = new Set<string>();
    for (const [pkg, framework] of Object.entries(frameworkMap)) {
      if (pkg in allDeps) {
        detectedFrameworks.add(framework);
      }
    }
    profile.frameworks = [...detectedFrameworks];

    // ── Languages ──────────────────────────────────────────
    const detectedLanguages = new Set<string>();

    // TypeScript
    if (
      (await WorkspaceScanner.fileExists(join(rootPath, "tsconfig.json"))) ||
      "typescript" in allDeps
    ) {
      detectedLanguages.add("typescript");
    }

    // JavaScript (package.json exists = JS project at minimum)
    if (Object.keys(allDeps).length > 0) {
      detectedLanguages.add("javascript");
    }

    // Python
    if (
      (await WorkspaceScanner.fileExists(join(rootPath, "requirements.txt"))) ||
      (await WorkspaceScanner.fileExists(join(rootPath, "pyproject.toml"))) ||
      (await WorkspaceScanner.fileExists(join(rootPath, "setup.py"))) ||
      (await WorkspaceScanner.fileExists(join(rootPath, "Pipfile")))
    ) {
      detectedLanguages.add("python");
    }

    // Rust
    if (await WorkspaceScanner.fileExists(join(rootPath, "Cargo.toml"))) {
      detectedLanguages.add("rust");
    }

    // Go
    if (await WorkspaceScanner.fileExists(join(rootPath, "go.mod"))) {
      detectedLanguages.add("go");
    }

    // Java / Kotlin
    if (
      (await WorkspaceScanner.fileExists(join(rootPath, "pom.xml"))) ||
      (await WorkspaceScanner.fileExists(join(rootPath, "build.gradle"))) ||
      (await WorkspaceScanner.fileExists(join(rootPath, "build.gradle.kts")))
    ) {
      detectedLanguages.add("java");
    }

    profile.languages = [...detectedLanguages];

    // ── Databases ──────────────────────────────────────────
    const detectedDatabases = new Set<string>();

    // From package.json deps
    const dbDepMap: Record<string, string> = {
      pg: "postgres",
      "pg-pool": "postgres",
      postgres: "postgres",
      "@neondatabase/serverless": "postgres",
      mysql2: "mysql",
      mysql: "mysql",
      ioredis: "redis",
      redis: "redis",
      "@redis/client": "redis",
      mongodb: "mongodb",
      mongoose: "mongodb",
      prisma: "prisma",
      "@prisma/client": "prisma",
      drizzle: "drizzle",
      "drizzle-orm": "drizzle",
      "better-sqlite3": "sqlite",
      sqlite3: "sqlite",
      libsql: "sqlite",
      "@libsql/client": "sqlite",
    };

    for (const [pkg, db] of Object.entries(dbDepMap)) {
      if (pkg in allDeps) {
        detectedDatabases.add(db);
      }
    }

    // From docker-compose.yml
    const composePath = join(rootPath, "docker-compose.yml");
    const composeAltPath = join(rootPath, "docker-compose.yaml");
    const composeFile = (await WorkspaceScanner.fileExists(composePath))
      ? composePath
      : (await WorkspaceScanner.fileExists(composeAltPath))
        ? composeAltPath
        : null;

    if (composeFile) {
      try {
        const composeContent = await Bun.file(composeFile).text();
        const lower = composeContent.toLowerCase();
        if (lower.includes("postgres")) detectedDatabases.add("postgres");
        if (lower.includes("mysql") || lower.includes("mariadb"))
          detectedDatabases.add("mysql");
        if (lower.includes("redis")) detectedDatabases.add("redis");
        if (lower.includes("mongo")) detectedDatabases.add("mongodb");
        if (lower.includes("elasticsearch") || lower.includes("elastic"))
          detectedDatabases.add("elasticsearch");
        if (lower.includes("rabbitmq") || lower.includes("amqp"))
          detectedDatabases.add("rabbitmq");
      } catch {
        // Unreadable compose file
      }
    }

    profile.database = [...detectedDatabases];

    // ── Test Frameworks ────────────────────────────────────
    const detectedTests = new Set<string>();

    // Config-file detection
    const testConfigMap: [string, string][] = [
      ["playwright.config.ts", "playwright"],
      ["playwright.config.js", "playwright"],
      ["jest.config.ts", "jest"],
      ["jest.config.js", "jest"],
      ["jest.config.cjs", "jest"],
      ["jest.config.mjs", "jest"],
      ["vitest.config.ts", "vitest"],
      ["vitest.config.js", "vitest"],
      ["vitest.config.mts", "vitest"],
      ["cypress.config.ts", "cypress"],
      ["cypress.config.js", "cypress"],
      [".mocharc.yml", "mocha"],
      [".mocharc.json", "mocha"],
    ];

    for (const [file, framework] of testConfigMap) {
      if (await WorkspaceScanner.fileExists(join(rootPath, file))) {
        detectedTests.add(framework);
      }
    }

    // Dep-based detection
    const testDepMap: Record<string, string> = {
      jest: "jest",
      vitest: "vitest",
      "@playwright/test": "playwright",
      mocha: "mocha",
      cypress: "cypress",
      ava: "ava",
    };

    for (const [pkg, framework] of Object.entries(testDepMap)) {
      if (pkg in allDeps) {
        detectedTests.add(framework);
      }
    }

    // Bun built-in test
    if (profile.packageManager === "bun") {
      detectedTests.add("bun-test");
    }

    profile.testFramework = [...detectedTests];

    // ── IDE Detection ──────────────────────────────────────
    const detectedIDEs = new Set<string>();

    if (existsSync(join(rootPath, ".vscode"))) detectedIDEs.add("vscode");
    if (existsSync(join(rootPath, ".cursor"))) detectedIDEs.add("cursor");
    if (existsSync(join(rootPath, ".idea"))) detectedIDEs.add("idea");
    if (existsSync(join(rootPath, ".fleet"))) detectedIDEs.add("fleet");
    if (existsSync(join(rootPath, ".zed"))) detectedIDEs.add("zed");

    profile.ide = [...detectedIDEs];

    // ── LLM Provider Keys ──────────────────────────────────
    const detectedKeys: LLMProvider[] = [];

    if (process.env.ANTHROPIC_API_KEY) detectedKeys.push("claude");
    if (process.env.OPENAI_API_KEY) detectedKeys.push("openai");
    if (process.env.GOOGLE_AI_KEY) detectedKeys.push("gemini");

    // Check Ollama availability (env var or default host)
    if (process.env.OLLAMA_HOST) {
      detectedKeys.push("ollama");
    } else {
      // Quick TCP check for local Ollama
      try {
        const resp = await fetch("http://localhost:11434", {
          method: "GET",
          signal: AbortSignal.timeout(1500),
        });
        if (resp.ok) detectedKeys.push("ollama");
      } catch {
        // Not available
      }
    }

    profile.llmKeys = detectedKeys;

    return profile;
  }

  // ── Helpers ──────────────────────────────────────────────

  /** Check file existence using Bun.file().exists() */
  private static async fileExists(path: string): Promise<boolean> {
    try {
      return await Bun.file(path).exists();
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Configuration Manager
// ─────────────────────────────────────────────────────────────

export class ConfigManager {
  private configDir: string;
  private configPath: string;

  constructor(rootPath: string) {
    this.configDir = join(rootPath, ".aether");
    this.configPath = join(this.configDir, "config.json");
  }

  /**
   * Initialize .aether/ directory with default config
   * based on a workspace scan result.
   */
  async init(workspace: WorkspaceProfile): Promise<AetherConfig> {
    // Create .aether/ directory tree
    const dirs = [
      this.configDir,
      join(this.configDir, "agents"),
      join(this.configDir, "logs"),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    // Build provider config from detected keys
    const providers = this.generateProviderConfig(workspace.llmKeys);

    // Assemble AetherConfig
    const config: AetherConfig = {
      version: "0.1.0",
      workspace,
      providers,
      server: {
        port: 9999,
        host: "localhost",
        authToken: crypto.randomUUID() + crypto.randomUUID().replace(/-/g, ""),
      },
      logging: {
        level: "info",
        file: join(this.configDir, "logs", "synapse.log"),
      },
    };

    // Write config.json
    await Bun.write(this.configPath, JSON.stringify(config, null, 2));

    // Write workspace.json (standalone copy for quick access)
    await Bun.write(
      join(this.configDir, "workspace.json"),
      JSON.stringify(workspace, null, 2),
    );

    // Write providers.json (standalone copy)
    await Bun.write(
      join(this.configDir, "providers.json"),
      JSON.stringify(providers, null, 2),
    );

    // Create empty synapse.log
    const logPath = join(this.configDir, "logs", "synapse.log");
    if (!existsSync(logPath)) {
      await Bun.write(logPath, "");
    }

    // Write default settings.json (user-editable knobs)
    const settingsManager = new SettingsManager(this.configDir);
    if (!settingsManager.exists()) {
      const defaultSettings = SettingsManager.defaults();
      defaultSettings.methodology.testCommand =
        SettingsManager.detectTestCommand(workspace);
      settingsManager.save(defaultSettings);
    }

    return config;
  }

  /**
   * Load existing config from .aether/config.json.
   * Returns null if the file doesn't exist or is unparseable.
   */
  async load(): Promise<AetherConfig | null> {
    try {
      const file = Bun.file(this.configPath);
      if (!(await file.exists())) return null;
      const raw = await file.text();
      return JSON.parse(raw) as AetherConfig;
    } catch {
      return null;
    }
  }

  /**
   * Save config to .aether/config.json (overwrites).
   */
  async save(config: AetherConfig): Promise<void> {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    await Bun.write(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Check whether .aether/ directory with a config.json exists.
   */
  isInitialized(): boolean {
    return existsSync(this.configPath);
  }

  /**
   * Return the absolute path to the .aether/ directory.
   */
  getConfigDir(): string {
    return this.configDir;
  }

  // ── Provider config generation ───────────────────────────

  /**
   * Generate a ProviderConfig based on which LLM providers
   * have API keys available.
   *
   * Priority order: claude > openai > gemini > ollama
   */
  private generateProviderConfig(keys: LLMProvider[]): ProviderConfig {
    // Default: Claude across all tiers
    const defaultMaster: ProviderModelConfig = {
      provider: "claude",
      model: "opus",
    };
    const defaultManager: ProviderModelConfig = {
      provider: "claude",
      model: "sonnet",
    };
    const defaultWorker: ProviderModelConfig = {
      provider: "claude",
      model: "haiku",
    };

    // Provider-specific tier configs
    const providerTiers: Record<
      LLMProvider,
      {
        master: ProviderModelConfig;
        manager: ProviderModelConfig;
        worker: ProviderModelConfig;
      }
    > = {
      claude: {
        master: { provider: "claude", model: "opus" },
        manager: { provider: "claude", model: "sonnet" },
        worker: { provider: "claude", model: "haiku" },
      },
      openai: {
        master: { provider: "openai", model: "gpt4o" },
        manager: { provider: "openai", model: "gpt4o" },
        worker: { provider: "openai", model: "gpt4o-mini" },
      },
      gemini: {
        master: { provider: "gemini", model: "gemini-ultra" },
        manager: { provider: "gemini", model: "gemini-pro" },
        worker: { provider: "gemini", model: "gemini-flash" },
      },
      ollama: {
        master: { provider: "ollama", model: "local" },
        manager: { provider: "ollama", model: "local" },
        worker: { provider: "ollama", model: "local" },
      },
    };

    // Pick the best available provider for primary use
    const preferred: LLMProvider = keys.includes("claude")
      ? "claude"
      : keys.includes("openai")
        ? "openai"
        : keys.includes("gemini")
          ? "gemini"
          : keys.includes("ollama")
            ? "ollama"
            : "claude"; // fallback to claude even if unconfigured

    const primary = providerTiers[preferred];

    // Build fallback chain from remaining providers
    const fallbackOrder: LLMProvider[] = [
      "claude",
      "openai",
      "gemini",
      "ollama",
    ];
    const fallbackChain: ProviderModelConfig[] = [];

    for (const provider of fallbackOrder) {
      if (provider === preferred) continue;
      if (keys.includes(provider)) {
        fallbackChain.push(providerTiers[provider].manager);
      }
    }

    // Always add ollama as last-resort fallback if not already included
    if (!keys.includes("ollama") && preferred !== "ollama") {
      fallbackChain.push({ provider: "ollama", model: "local" });
    }

    return {
      master: primary.master,
      manager: primary.manager,
      worker: primary.worker,
      fallbackChain,
    };
  }
}
