#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// AETHER CLI — `aether` command entrypoint
// Autonomous Agent Orchestration Framework
// ─────────────────────────────────────────────────────────────

import { AetherRuntime } from "../core/runtime.ts";
import { WorkspaceScanner, ConfigManager } from "../core/config.ts";
import { SettingsManager } from "../core/settings.ts";
import type { LLMProvider } from "../core/types.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const VERSION = "0.2.0";

const BANNER = `
╔══════════════════════════════════════════╗
║           ◈ A E T H E R ◈              ║
║   Autonomous Agent Orchestration v${VERSION}  ║
║   Runtime: Bun ${Bun.version.padEnd(24, " ")}║
╚══════════════════════════════════════════╝
`;

// ── Parse CLI arguments ────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];

// ── Helpers ────────────────────────────────────────────────

/** Right-pad a string to a fixed width */
function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

/** Format milliseconds to human-readable duration */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── Command Handlers ───────────────────────────────────────

async function handleInit(): Promise<void> {
  console.log(BANNER);
  console.log("⟐ Initializing AETHER in current workspace...\n");

  const cwd = process.cwd();

  // Check if already initialized
  const configManager = new ConfigManager(cwd);
  if (configManager.isInitialized()) {
    console.log("  ⚠ .aether/ already exists. Re-scanning workspace...\n");
  }

  // Step 1: Scan workspace
  console.log("  ◇ Scanning workspace...");
  const profile = await WorkspaceScanner.scan(cwd);
  console.log(`    Package Manager: ${profile.packageManager}`);
  console.log(
    `    Frameworks:      ${profile.frameworks.join(", ") || "none detected"}`,
  );
  console.log(
    `    Languages:       ${profile.languages.join(", ") || "none detected"}`,
  );
  console.log(
    `    Databases:       ${profile.database.join(", ") || "none detected"}`,
  );
  console.log(
    `    Test Frameworks: ${profile.testFramework.join(", ") || "none detected"}`,
  );
  console.log(
    `    IDE:             ${profile.ide.join(", ") || "none detected"}`,
  );
  console.log(
    `    LLM Providers:   ${profile.llmKeys.join(", ") || "none detected"}`,
  );

  // Step 2: Initialize config
  console.log("\n  ◇ Creating .aether/ configuration...");
  const config = await configManager.init(profile);
  console.log("    Config written to .aether/config.json");
  console.log("    Settings written to .aether/settings.json");
  console.log("    Workspace profile → .aether/workspace.json");
  console.log("    Provider config   → .aether/providers.json");

  // Step 3: Discover agents
  console.log("\n  ◇ Discovering agents...");
  const agentDirs = [
    join(cwd, ".github", "agents"),
    join(cwd, ".aether", "agents"),
    join(cwd, "agents"),
  ];

  const runtime = new AetherRuntime(cwd);
  let agentCount = 0;

  for (const dir of agentDirs) {
    if (existsSync(dir)) {
      const agents = await runtime.discoverAgents(dir);
      for (const agent of agents) {
        console.log(
          `    ✓ ${agent.id} (${agent.tier}) [${agent.sections.join(", ") || "—"}]`,
        );
      }
      agentCount += agents.length;
    }
  }

  if (agentCount === 0) {
    console.log("    No .agent.md files found.");
    console.log(
      "    Place agent definitions in agents/, .aether/agents/, or .github/agents/",
    );
  }

  // Shutdown runtime logger
  await runtime.logger.close();

  console.log(
    `\n⟐ AETHER initialized. ${agentCount} agent${agentCount !== 1 ? "s" : ""} discovered.`,
  );
  console.log("  Run 'aether link' to start the Aether-Link server.");
  console.log("  Run 'aether registry' to view registered agents.");
}

async function handleStatus(): Promise<void> {
  const cwd = process.cwd();
  const configManager = new ConfigManager(cwd);

  if (!configManager.isInitialized()) {
    console.log("⟐ AETHER is not initialized in this workspace.");
    console.log("  Run 'aether init' first.");
    return;
  }

  const config = await configManager.load();
  if (!config) {
    console.log("⟐ Failed to load .aether/config.json");
    return;
  }

  console.log(BANNER);
  console.log("⟐ AETHER Status\n");

  // Config info
  console.log("  Config:");
  console.log(`    Version:  ${config.version}`);
  console.log(`    Root:     ${config.workspace.rootPath}`);
  console.log(`    Pkg Mgr:  ${config.workspace.packageManager}`);

  // Workspace
  console.log("\n  Workspace:");
  console.log(
    `    Frameworks:      ${config.workspace.frameworks.join(", ") || "—"}`,
  );
  console.log(
    `    Languages:       ${config.workspace.languages.join(", ") || "—"}`,
  );
  console.log(
    `    Databases:       ${config.workspace.database.join(", ") || "—"}`,
  );
  console.log(
    `    Test Frameworks: ${config.workspace.testFramework.join(", ") || "—"}`,
  );

  // Providers
  console.log("\n  Providers:");
  console.log(
    `    Master:  ${config.providers.master.provider} (${config.providers.master.model})`,
  );
  console.log(
    `    Manager: ${config.providers.manager.provider} (${config.providers.manager.model})`,
  );
  console.log(
    `    Worker:  ${config.providers.worker.provider} (${config.providers.worker.model})`,
  );
  console.log(
    `    Fallbacks: ${config.providers.fallbackChain.map((f) => f.provider).join(" → ") || "none"}`,
  );

  // Server
  console.log("\n  Server:");
  console.log(
    `    Configured: ws://${config.server.host}:${config.server.port}`,
  );

  // Check if server is actually running by pinging the status endpoint
  try {
    const resp = await fetch(
      `http://${config.server.host}:${config.server.port}/status`,
      {
        signal: AbortSignal.timeout(2000),
      },
    );
    if (resp.ok) {
      const metrics = (await resp.json()) as {
        connectedAgents: number;
        messageCount: number;
        messagesPerSecond: number;
        uptimeMs: number;
      };
      console.log(`    Status:    ● RUNNING`);
      console.log(`    Uptime:    ${formatDuration(metrics.uptimeMs)}`);
      console.log(`    Agents:    ${metrics.connectedAgents} connected`);
      console.log(
        `    Messages:  ${metrics.messageCount} total (${metrics.messagesPerSecond}/s)`,
      );
    } else {
      console.log("    Status:    ○ OFFLINE");
    }
  } catch {
    console.log("    Status:    ○ OFFLINE");
  }

  // Agent count
  console.log("\n  Agents:");
  const runtime = new AetherRuntime(cwd);
  const agentDirs = [
    join(cwd, ".github", "agents"),
    join(cwd, ".aether", "agents"),
    join(cwd, "agents"),
  ];
  let total = 0;
  for (const dir of agentDirs) {
    if (existsSync(dir)) {
      const agents = await runtime.discoverAgents(dir);
      total += agents.length;
    }
  }
  console.log(`    Discovered: ${total} agent${total !== 1 ? "s" : ""}`);
  await runtime.logger.close();
}

async function handleLink(): Promise<void> {
  console.log(BANNER);
  console.log("⟐ Starting Aether-Link WebSocket Server...\n");

  const cwd = process.cwd();
  const configManager = new ConfigManager(cwd);

  if (!configManager.isInitialized()) {
    console.log("  ✗ AETHER is not initialized. Run 'aether init' first.");
    process.exit(1);
  }

  const runtime = new AetherRuntime(cwd);
  await runtime.init();
  await runtime.startServer();

  const config = await configManager.load();
  const port = config?.server?.port ?? 9999;
  const host = config?.server?.host ?? "localhost";

  console.log(`  ◇ Server running on ws://${host}:${port}`);
  console.log(`  ◇ HTTP status: http://${host}:${port}/status`);
  console.log(`  ◇ Registry:    http://${host}:${port}/registry`);
  console.log("  ◇ Press Ctrl+C to stop\n");

  const allAgents = runtime.registry.getAll();
  if (allAgents.length > 0) {
    console.log(
      `  ◇ ${allAgents.length} agent${allAgents.length !== 1 ? "s" : ""} loaded:`,
    );
    for (const a of allAgents) {
      console.log(`    • ${a.id} (${a.tier})`);
    }
    console.log("");
  }

  // Graceful shutdown handler with timeout
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n⟐ Shutting down AETHER...");

    // Force exit after 15 seconds if graceful shutdown hangs
    const forceTimer = setTimeout(() => {
      console.error("⟐ Shutdown timed out after 15s — forcing exit");
      process.exit(1);
    }, 15_000);
    if (forceTimer && typeof forceTimer === "object" && "unref" in forceTimer) {
      (forceTimer as { unref: () => void }).unref();
    }

    try {
      await runtime.shutdown();
      console.log("⟐ Shutdown complete.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`⟐ Shutdown error: ${msg}`);
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function handleRegistry(): Promise<void> {
  const cwd = process.cwd();
  const configManager = new ConfigManager(cwd);

  if (!configManager.isInitialized()) {
    console.log("⟐ AETHER is not initialized. Run 'aether init' first.");
    return;
  }

  // Discover agents
  const runtime = new AetherRuntime(cwd);
  const agentDirs = [
    join(cwd, ".github", "agents"),
    join(cwd, ".aether", "agents"),
    join(cwd, "agents"),
  ];

  for (const dir of agentDirs) {
    if (existsSync(dir)) {
      await runtime.discoverAgents(dir);
    }
  }

  const agents = runtime.registry.getAll();

  if (agents.length === 0) {
    console.log("⟐ No agents registered.");
    console.log(
      "  Place .agent.md files in agents/, .aether/agents/, or .github/agents/",
    );
    await runtime.logger.close();
    return;
  }

  // ── ASCII table ──────────────────────────────────────────
  const COL_ID = 24;
  const COL_TIER = 10;
  const COL_SECTIONS = 22;
  const COL_STATUS = 10;
  const COL_FORMAT = 10;
  const COL_MODEL = 14;
  const TOTAL_WIDTH =
    COL_ID + COL_TIER + COL_SECTIONS + COL_STATUS + COL_FORMAT + COL_MODEL + 7; // 7 for separators

  const hLine = "─".repeat(TOTAL_WIDTH);
  const header = `│ ${pad("ID", COL_ID)}│ ${pad("Tier", COL_TIER)}│ ${pad("Sections", COL_SECTIONS)}│ ${pad("Status", COL_STATUS)}│ ${pad("Format", COL_FORMAT)}│ ${pad("Model", COL_MODEL)}│`;

  console.log(
    `\n⟐ Agent Registry (${agents.length} agent${agents.length !== 1 ? "s" : ""})\n`,
  );
  console.log(`┌${hLine}┐`);
  console.log(header);
  console.log(`├${hLine}┤`);

  for (const agent of agents) {
    const sectionsStr = agent.sections.join(", ") || "—";
    const row = `│ ${pad(agent.id, COL_ID)}│ ${pad(agent.tier, COL_TIER)}│ ${pad(sectionsStr, COL_SECTIONS)}│ ${pad(agent.status, COL_STATUS)}│ ${pad(agent.format, COL_FORMAT)}│ ${pad(agent.llmRequirement, COL_MODEL)}│`;
    console.log(row);
  }

  console.log(`└${hLine}┘`);

  // Section summary
  const sectionCounts = runtime.registry.getSectionCounts();
  const activeSections = Object.entries(sectionCounts)
    .filter(([, count]) => count > 0)
    .map(([section, count]) => `${section}: ${count}`)
    .join("  ");

  if (activeSections) {
    console.log(`\n  Sections: ${activeSections}`);
  }

  await runtime.logger.close();
}

async function handleSpawn(agentId?: string): Promise<void> {
  if (!agentId) {
    console.error("Usage: aether spawn <agent-id>");
    console.error(
      "  Activate a specific agent and make it ready to receive tasks.",
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const configManager = new ConfigManager(cwd);

  if (!configManager.isInitialized()) {
    console.log("⟐ AETHER is not initialized. Run 'aether init' first.");
    process.exit(1);
  }

  console.log(BANNER);
  console.log(`⟐ Spawning agent: ${agentId}\n`);

  // Boot runtime and discover agents
  const runtime = new AetherRuntime(cwd);
  await runtime.init();

  const agent = runtime.registry.get(agentId);
  if (!agent) {
    console.log(`  ✗ Agent "${agentId}" not found in registry.`);
    console.log("  Available agents:");
    const allAgents = runtime.registry.getAll();
    for (const a of allAgents) {
      console.log(`    • ${a.id} (${a.tier})`);
    }
    if (allAgents.length === 0) {
      console.log("    (none — place .agent.md files in agents/)");
    }
    await runtime.shutdown();
    process.exit(1);
  }

  // Mark as active
  runtime.registry.updateStatus(agentId, "active");
  const updated = runtime.registry.get(agentId)!;

  console.log(`  ✓ Agent activated`);
  console.log(`    ID:        ${updated.id}`);
  console.log(`    Name:      ${updated.name}`);
  console.log(`    Tier:      ${updated.tier}`);
  console.log(`    Sections:  ${updated.sections.join(", ") || "—"}`);
  console.log(`    Format:    ${updated.format}`);
  console.log(`    Model:     ${updated.llmRequirement}`);
  console.log(`    Status:    ${updated.status}`);
  console.log(`    File:      ${updated.filePath}`);

  if (updated.capabilities.length > 0) {
    console.log(`    Capabilities:`);
    for (const cap of updated.capabilities) {
      console.log(`      • ${cap}`);
    }
  }

  // Check if Aether-Link server is running
  const config = await configManager.load();
  const port = config?.server?.port ?? 9999;
  const host = config?.server?.host ?? "localhost";

  try {
    const resp = await fetch(`http://${host}:${port}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      console.log(
        `\n  ◇ Aether-Link server is running on ws://${host}:${port}`,
      );
      console.log("  ◇ Agent can receive tasks via the WebSocket connection.");
    }
  } catch {
    console.log("\n  ⚠ Aether-Link server is not running.");
    console.log("  Run 'aether link' to start it.");
  }

  await runtime.shutdown();
}

async function handleRun(runArgs: string[]): Promise<void> {
  const cwd = process.cwd();
  const configManager = new ConfigManager(cwd);

  if (!configManager.isInitialized()) {
    console.log("⟐ AETHER is not initialized. Run 'aether init' first.");
    process.exit(1);
  }

  // ── Parse flags ──────────────────────────────────────────
  let provider: LLMProvider | undefined;
  let model: string | undefined;
  let agent: string | undefined;
  const taskParts: string[] = [];

  for (let i = 0; i < runArgs.length; i++) {
    const arg = runArgs[i];
    if ((arg === "-p" || arg === "--provider") && i + 1 < runArgs.length) {
      provider = runArgs[++i] as LLMProvider;
    } else if ((arg === "-m" || arg === "--model") && i + 1 < runArgs.length) {
      model = runArgs[++i];
    } else if ((arg === "-a" || arg === "--agent") && i + 1 < runArgs.length) {
      agent = runArgs[++i];
    } else {
      taskParts.push(arg);
    }
  }

  const taskText = taskParts.join(" ").trim();
  if (!taskText) {
    console.log("Usage: aether run [options] <task description>");
    console.log("");
    console.log("Options:");
    console.log(
      "  -p, --provider <name>  LLM provider (claude, openai, gemini, ollama)",
    );
    console.log("  -m, --model <name>     Model name or alias");
    console.log("  -a, --agent <id>       Target agent ID");
    console.log("");
    console.log("Examples:");
    console.log('  aether run "What is 2+2?"');
    console.log(
      '  aether run -p gemini -m gemini-2.0-flash "explain recursion"',
    );
    process.exit(1);
  }

  // ── Boot & Execute ───────────────────────────────────────
  const runtime = new AetherRuntime(cwd);

  // Graceful shutdown with timeout
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const forceTimer = setTimeout(() => {
      console.error("⟐ Shutdown timed out after 15s — forcing exit");
      process.exit(1);
    }, 15_000);
    if (forceTimer && typeof forceTimer === "object" && "unref" in forceTimer) {
      (forceTimer as { unref: () => void }).unref();
    }

    try {
      await runtime.shutdown();
    } catch {
      // Best-effort shutdown
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    const result = await runtime.run(taskText, { agent, provider, model });

    // ── Display Result ───────────────────────────────────
    const icon =
      result.status === "success"
        ? "✓"
        : result.status === "partial"
          ? "◐"
          : "✗";
    const statusColor =
      result.status === "success"
        ? "\x1b[32m"
        : result.status === "failure"
          ? "\x1b[31m"
          : "\x1b[33m";
    const reset = "\x1b[0m";

    console.log(`\n${statusColor}${icon}${reset} [${result.executor}]\n`);

    // Print the output
    const output =
      typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output, null, 2);
    console.log(output);

    // Print metadata footer
    const meta: string[] = [];
    if (result.tokensUsed) meta.push(`Tokens: ${result.tokensUsed}`);
    meta.push(`Duration: ${formatDuration(result.duration)}`);
    if (provider) meta.push(`Provider: ${provider}`);
    if (model) meta.push(`Model: ${model}`);
    console.log(`\n${statusColor}─${reset} ${meta.join(" │ ")}`);

    await runtime.shutdown();
    process.exit(
      result.status === "success" || result.status === "partial" ? 0 : 1,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Task failed: ${msg}`);
    await runtime.shutdown();
    process.exit(1);
  }
}

async function handleScan(): Promise<void> {
  console.log(BANNER);
  console.log("⟐ Scanning workspace...\n");

  const cwd = process.cwd();
  const profile = await WorkspaceScanner.scan(cwd);

  console.log(`  Root:            ${profile.rootPath}`);
  console.log(`  Package Manager: ${profile.packageManager}`);
  console.log("");

  // Pretty-print each category
  const categories: [string, string[]][] = [
    ["Frameworks", profile.frameworks],
    ["Languages", profile.languages],
    ["Databases", profile.database],
    ["Test Frameworks", profile.testFramework],
    ["IDE", profile.ide],
    ["LLM Providers", profile.llmKeys],
  ];

  for (const [label, items] of categories) {
    if (items.length > 0) {
      console.log(`  ${label}:`);
      for (const item of items) {
        console.log(`    ✓ ${item}`);
      }
    } else {
      console.log(`  ${label}: none detected`);
    }
  }

  console.log("\n⟐ Scan complete.");
}

async function handleConfig(configArgs: string[]): Promise<void> {
  const cwd = process.cwd();
  const aetherDir = join(cwd, ".aether");
  const sm = new SettingsManager(aetherDir);

  const subCommand = configArgs[0] || "";

  switch (subCommand) {
    case "": {
      // Show all current settings
      const settings = sm.load();
      console.log(JSON.stringify(settings, null, 2));
      break;
    }

    case "get": {
      const path = configArgs[1];
      if (!path) {
        console.error("Usage: aether config get <path>");
        console.error('  e.g. aether config get execution.maxDepth');
        process.exit(1);
      }
      sm.load();
      const value = sm.get(path);
      if (value === undefined) {
        console.error(`Setting "${path}" not found.`);
        process.exit(1);
      }
      if (typeof value === "object" && value !== null) {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(String(value));
      }
      break;
    }

    case "set": {
      const path = configArgs[1];
      const rawValue = configArgs[2];
      if (!path || rawValue === undefined) {
        console.error("Usage: aether config set <path> <value>");
        console.error('  e.g. aether config set execution.maxDepth 5');
        process.exit(1);
      }

      // Parse value: try number, boolean, then string
      let parsed: unknown = rawValue;
      if (rawValue === "true") parsed = true;
      else if (rawValue === "false") parsed = false;
      else if (rawValue === "null") parsed = null;
      else if (/^-?\d+(\.\d+)?$/.test(rawValue)) parsed = Number(rawValue);

      // Validate before setting
      sm.load();
      sm.set(path, parsed);

      // Validate the full settings
      const validation = sm.validate(sm.load());
      if (!validation.valid) {
        console.error("Warning: Settings validation failed after change:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
      } else {
        console.log(`Set ${path} = ${JSON.stringify(parsed)}`);
      }
      break;
    }

    case "reset": {
      const section = configArgs[1];
      sm.load();
      sm.reset(section);
      if (section) {
        console.log(`Reset "${section}" to defaults.`);
      } else {
        console.log("Reset all settings to defaults.");
      }
      break;
    }

    case "path": {
      console.log(sm.getPath());
      break;
    }

    case "edit": {
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      const settingsPath = sm.getPath();
      // Ensure file exists before opening
      if (!sm.exists()) {
        sm.save(SettingsManager.defaults());
      }
      const proc = Bun.spawn([editor, settingsPath], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
      break;
    }

    case "validate": {
      const settings = sm.load();
      const result = sm.validate(settings);
      if (result.valid) {
        console.log("Settings are valid.");
      } else {
        console.error("Settings validation errors:");
        for (const err of result.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown config sub-command: ${subCommand}`);
      console.log("");
      console.log("Usage: aether config [sub-command]");
      console.log("");
      console.log("Sub-commands:");
      console.log("  (none)              Show all current settings");
      console.log("  get <path>          Get a specific setting");
      console.log("  set <path> <value>  Set a specific setting");
      console.log("  reset [section]     Reset to defaults (all or specific section)");
      console.log("  path                Print path to settings.json");
      console.log("  edit                Open settings.json in $EDITOR");
      console.log("  validate            Validate current settings");
      console.log("");
      console.log("Examples:");
      console.log('  aether config get execution.maxDepth');
      console.log('  aether config set execution.maxDepth 5');
      console.log('  aether config set methodology.mode sdd');
      console.log('  aether config reset execution');
      process.exit(1);
  }
}

// ── Context (namespace) command ───────────────────────────────

async function handleContext(contextArgs: string[]): Promise<void> {
  const cwd = process.cwd();
  const aetherDir = join(cwd, ".aether");
  const settingsManager = new SettingsManager(aetherDir);

  if (!settingsManager.exists()) {
    console.error("No settings.json found. Run `aether init` first.");
    process.exit(1);
  }

  const settings = settingsManager.load();
  const subCommand = contextArgs[0] ?? "";

  switch (subCommand) {
    case "":
    case "show": {
      const active = settings.routing.activeContext;
      const agentIds = settings.routing.contexts[active] ?? [];
      console.log(`Active context: ${active}`);
      if (agentIds.includes("*")) {
        console.log("  Agents: * (all agents)");
      } else if (agentIds.length === 0) {
        console.log("  Agents: (none)");
      } else {
        console.log(`  Agents: ${agentIds.join(", ")}`);
      }
      break;
    }

    case "list": {
      const contexts = settings.routing.contexts;
      const active = settings.routing.activeContext;
      console.log("Defined contexts:");
      for (const [name, ids] of Object.entries(contexts)) {
        const marker = name === active ? " (active)" : "";
        const agents = ids.includes("*") ? "* (all)" : ids.join(", ");
        console.log(`  ${name}${marker}: ${agents}`);
      }
      break;
    }

    case "switch": {
      const name = contextArgs[1];
      if (!name) {
        console.error("Usage: aether context switch <name>");
        process.exit(1);
      }
      if (!settings.routing.contexts[name]) {
        console.error(`Context "${name}" does not exist. Use 'aether context list' to see available contexts.`);
        process.exit(1);
      }
      settingsManager.set("routing.activeContext", name);
      console.log(`Switched active context to "${name}".`);
      break;
    }

    case "create": {
      const name = contextArgs[1];
      const agentList = contextArgs[2];
      if (!name || !agentList) {
        console.error("Usage: aether context create <name> <agent1,agent2,...>");
        process.exit(1);
      }
      const agentIds = agentList.split(",").map((s) => s.trim()).filter(Boolean);
      if (agentIds.length === 0) {
        console.error("Agent list must contain at least one agent ID.");
        process.exit(1);
      }
      const contexts = { ...settings.routing.contexts, [name]: agentIds };
      settingsManager.set("routing.contexts", contexts);
      console.log(`Created context "${name}" with agents: ${agentIds.join(", ")}`);
      break;
    }

    case "delete": {
      const name = contextArgs[1];
      if (!name) {
        console.error("Usage: aether context delete <name>");
        process.exit(1);
      }
      if (name === "default") {
        console.error('Cannot delete the "default" context.');
        process.exit(1);
      }
      if (!settings.routing.contexts[name]) {
        console.error(`Context "${name}" does not exist.`);
        process.exit(1);
      }
      const contexts = { ...settings.routing.contexts };
      delete contexts[name];
      settingsManager.set("routing.contexts", contexts);
      // If the deleted context was active, switch back to default
      if (settings.routing.activeContext === name) {
        settingsManager.set("routing.activeContext", "default");
        console.log(`Deleted context "${name}". Active context switched to "default".`);
      } else {
        console.log(`Deleted context "${name}".`);
      }
      break;
    }

    default:
      console.log("Usage: aether context [show|list|switch|create|delete]");
      console.log("");
      console.log("Sub-commands:");
      console.log("  show               Show active context and its agents");
      console.log("  list               List all defined contexts");
      console.log("  switch <name>      Set the active context");
      console.log("  create <name> <a1,a2,...>  Create a new context");
      console.log("  delete <name>      Delete a context");
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(BANNER);
  console.log("Commands:");
  console.log("  run <task>  Execute a task with an AI agent");
  console.log("  init        Initialize AETHER in current workspace");
  console.log("  link        Start the Aether-Link WebSocket server");
  console.log("  status      Show runtime and server status");
  console.log("  registry    List all registered agents");
  console.log("  spawn <id>  Activate a specific agent");
  console.log("  config      View and manage settings");
  console.log("  context     Manage agent namespaces/contexts");
  console.log("  scan        Scan workspace and display tech stack");
  console.log("  version     Show version");
  console.log("  help        Show this help");
  console.log("");
  console.log("Run Options:");
  console.log(
    "  -p, --provider <name>  LLM provider (claude, openai, gemini, ollama)",
  );
  console.log(
    "  -m, --model <name>     Model name or alias (gemini-2.0-flash, gpt-4o, etc.)",
  );
  console.log("  -a, --agent <id>       Target agent ID");
  console.log("");
  console.log("General Options:");
  console.log("  -v, --version    Show version number");
  console.log("  -h, --help       Show this help message");
  console.log("");
  console.log("Examples:");
  console.log('  $ aether run "explain quicksort"');
  console.log(
    '  $ aether run -p gemini -m gemini-2.0-flash "explain quicksort"',
  );
  console.log('  $ aether run -p ollama -m deepseek-r1 "hello world"');
  console.log('  $ aether run -a cortex-0 "decompose this project"');
  console.log("  $ aether init            # Scan & configure workspace");
  console.log("  $ aether link            # Start WebSocket server");
  console.log("  $ aether registry        # View agent table");
}

// ── Main dispatch ──────────────────────────────────────────

async function main(): Promise<void> {
  switch (command) {
    case "run":
      await handleRun(args.slice(1));
      break;
    case "init":
      await handleInit();
      break;
    case "status":
      await handleStatus();
      break;
    case "link":
      await handleLink();
      break;
    case "registry":
      await handleRegistry();
      break;
    case "spawn":
      await handleSpawn(args[1]);
      break;
    case "scan":
      await handleScan();
      break;
    case "config":
      await handleConfig(args.slice(1));
      break;
    case "context":
      await handleContext(args.slice(1));
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      if (command) {
        console.error(`Unknown command: ${command}\n`);
      }
      showHelp();
      break;
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`\n[AETHER_ERR] Fatal: ${msg}`);
  if (stack) {
    console.error(stack);
  }
  process.exit(1);
});
