// ─────────────────────────────────────────────────────────────
// AETHER Transport — CLI Subprocess
// Runs external agents as child processes (Python scripts,
// Node.js tools, compiled binaries, shell scripts, etc.)
// ─────────────────────────────────────────────────────────────

import { BaseTransport, type TransportHealthCheck } from "./base.ts";
import type {
  TaskRequest,
  TaskResult,
  AgentDefinition,
  TransportConfig,
  CLITransportConfig,
} from "../core/types.ts";

export class CLITransport extends BaseTransport {
  constructor() {
    super("cli");
  }

  async connect(_config: TransportConfig): Promise<void> {
    // CLI is per-invocation — no persistent connection
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async execute(
    task: TaskRequest,
    agent: AgentDefinition,
    config: TransportConfig,
  ): Promise<TaskResult> {
    const cliConfig = config as CLITransportConfig;
    const startTime = Date.now();

    try {
      // Build the task payload
      const taskJson = JSON.stringify({
        id: task.id,
        description: task.description,
        context: task.context,
        priority: task.priority,
        requester: task.requester,
      });

      // Build command args
      const args = [...(cliConfig.args ?? [])];

      // Handle input format
      let stdin: string | undefined;

      switch (cliConfig.inputFormat) {
        case "stdin-json":
          stdin = taskJson;
          break;
        case "args":
          args.push(taskJson);
          break;
        case "file": {
          const ioPath =
            cliConfig.ioFilePath ?? `/tmp/aether-task-${task.id}.json`;
          await Bun.write(ioPath, taskJson);
          args.push(ioPath);
          break;
        }
      }

      // Spawn the subprocess
      const proc = Bun.spawn([cliConfig.command, ...args], {
        cwd: cliConfig.cwd,
        env: { ...process.env, ...cliConfig.env },
        stdin: stdin ? new Blob([stdin]) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Set up timeout
      const timeout = cliConfig.timeout ?? 120_000;
      const timeoutId = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // Process may already be dead
        }
      }, timeout);

      // Wait for completion
      const exitCode = await proc.exited;
      clearTimeout(timeoutId);

      // Read stdout and stderr
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        return this.failResult(
          task.id,
          agent.id,
          `CLI process exited with code ${exitCode}: ${stderr || stdout}`,
          startTime,
        );
      }

      // Parse output based on format
      const output = this.parseOutput(stdout, cliConfig);

      return this.successResult(task.id, agent.id, output, startTime);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failResult(
        task.id,
        agent.id,
        `CLI transport error: ${msg}`,
        startTime,
      );
    }
  }

  async healthCheck(config: TransportConfig): Promise<TransportHealthCheck> {
    const cliConfig = config as CLITransportConfig;
    const start = Date.now();

    try {
      // Check if the command is executable
      const proc = Bun.spawn([cliConfig.command, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: cliConfig.cwd,
        env: { ...process.env, ...cliConfig.env },
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      return {
        healthy: exitCode === 0,
        latencyMs: Date.now() - start,
        details: stdout.trim().slice(0, 200),
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Internals ──────────────────────────────────────────────

  private parseOutput(stdout: string, config: CLITransportConfig): unknown {
    switch (config.outputFormat) {
      case "stdout-json":
        try {
          return JSON.parse(stdout.trim());
        } catch {
          // If JSON parsing fails, return raw text
          return {
            raw: stdout.trim(),
            parseError: "Output was not valid JSON",
          };
        }

      case "stdout-text":
        return stdout.trim();

      case "file": {
        const ioPath = config.ioFilePath ?? "/tmp/aether-output.json";
        try {
          const content = require("fs").readFileSync(ioPath, "utf-8");
          return JSON.parse(content);
        } catch {
          return { error: `Failed to read output file: ${ioPath}` };
        }
      }

      default:
        return stdout.trim();
    }
  }
}
