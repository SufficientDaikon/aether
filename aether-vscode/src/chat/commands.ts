// ─────────────────────────────────────────────────────────────
// AETHER Chat Slash Commands
//
// Handlers for /plan, /run, /review, /test, /debug,
// /architect, /group, /status, /context
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

export async function handleSlashCommand(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  bridge: AetherBridge,
): Promise<void> {
  if (!bridge.isConnected()) {
    stream.markdown(
      "**AETHER is not connected.** Check the output panel for details.",
    );
    return;
  }

  switch (request.command) {
    case "run":
      return cmdRun(request, stream, token, bridge);
    case "plan":
      return cmdPlan(request, stream, token, bridge);
    case "review":
      return cmdTargeted(
        request,
        stream,
        token,
        bridge,
        "code-reviewer",
        "Reviewing code",
      );
    case "test":
      return cmdTargeted(
        request,
        stream,
        token,
        bridge,
        "test-engineer",
        "Generating tests",
      );
    case "debug":
      return cmdTargeted(
        request,
        stream,
        token,
        bridge,
        "debugger",
        "Investigating",
      );
    case "architect":
      return cmdTargeted(
        request,
        stream,
        token,
        bridge,
        "system-architect",
        "Designing architecture",
      );
    case "group":
      return cmdGroup(request, stream, token, bridge);
    case "status":
      return cmdStatus(stream, bridge);
    case "context":
      return cmdContext(request, stream, bridge);
    default:
      stream.markdown(`Unknown command: /${request.command}`);
  }
}

// ── /run — Execute on best-fit (or named) agent ──────────────

async function cmdRun(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  bridge: AetherBridge,
): Promise<void> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    stream.markdown(
      "Usage: `/run <task description>` or `/run @agent-id <task>`",
    );
    return;
  }

  // Check for @agent-id prefix
  let target: string | undefined;
  let description = prompt;
  const atMatch = prompt.match(/^@([\w-]+)\s+(.*)/s);
  if (atMatch) {
    target = atMatch[1];
    description = atMatch[2];
  }

  stream.progress(
    target ? `Running on ${target}...` : "Routing to best-fit agent...",
  );

  try {
    const args: Record<string, unknown> = { description };
    if (target) args.target = target;

    const result = await bridge.callTool("submit_task", args);
    if (token.isCancellationRequested) return;
    renderResult(stream, result);
  } catch (err) {
    stream.markdown(
      `**Error:** ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── /plan — Decompose into sub-tasks ─────────────────────────

async function cmdPlan(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  bridge: AetherBridge,
): Promise<void> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    stream.markdown("Usage: `/plan <what you want to build>`");
    return;
  }

  stream.progress("Planning with system-architect...");

  try {
    const result = await bridge.callTool("submit_task", {
      description: `Break down the following into a detailed plan with sub-tasks and agent assignments:\n\n${prompt}`,
      target: "system-architect",
    });
    if (token.isCancellationRequested) return;
    renderResult(stream, result);
  } catch (err) {
    stream.markdown(
      `**Error:** ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── /review, /test, /debug, /architect — Targeted commands ───

async function cmdTargeted(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  bridge: AetherBridge,
  agentId: string,
  progressMsg: string,
): Promise<void> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    stream.markdown(`Usage: \`/${request.command} <description>\``);
    return;
  }

  stream.progress(`${progressMsg}...`);

  try {
    const result = await bridge.callTool("submit_task", {
      description: prompt,
      target: agentId,
    });
    if (token.isCancellationRequested) return;
    renderResult(stream, result);
  } catch (err) {
    stream.markdown(
      `**Error:** ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── /group — Multi-agent discussion ──────────────────────────

async function cmdGroup(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  bridge: AetherBridge,
): Promise<void> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    stream.markdown("Usage: `/group <problem to discuss>`");
    return;
  }

  stream.progress("Starting multi-agent group discussion...");

  try {
    const result = await bridge.callTool("submit_task", {
      description: `Coordinate a multi-agent group discussion on the following problem. Involve relevant domain experts and synthesize their perspectives:\n\n${prompt}`,
    });
    if (token.isCancellationRequested) return;
    renderResult(stream, result);
  } catch (err) {
    stream.markdown(
      `**Error:** ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── /status — Show system status ─────────────────────────────

async function cmdStatus(
  stream: vscode.ChatResponseStream,
  bridge: AetherBridge,
): Promise<void> {
  try {
    const result = await bridge.callTool("get_status", {});
    if (!result) {
      stream.markdown("Could not retrieve status.");
      return;
    }

    const status = JSON.parse(result);
    const lines = [
      "## AETHER Status\n",
      `| Property | Value |`,
      `|----------|-------|`,
      `| Version | ${status.version ?? "unknown"} |`,
      `| Agents | ${status.agents?.total ?? 0} total (${status.agents?.idle ?? 0} idle, ${status.agents?.busy ?? 0} busy) |`,
      `| Master | ${status.agents?.byTier?.master ?? 0} |`,
      `| Managers | ${status.agents?.byTier?.manager ?? 0} |`,
      `| Workers | ${status.agents?.byTier?.worker ?? 0} |`,
      `| Context | ${status.activeContext ?? "default"} |`,
      `| Contexts | ${(status.contexts ?? []).join(", ")} |`,
      `| RAG | ${status.ragAvailable ? "Available" : "Not available"} |`,
    ];

    if (status.cacheStats) {
      lines.push(`| Cache Hits | ${status.cacheStats.hits ?? 0} |`);
      lines.push(`| Cache Misses | ${status.cacheStats.misses ?? 0} |`);
      lines.push(`| Cache Size | ${status.cacheStats.size ?? 0} |`);
    }

    stream.markdown(lines.join("\n"));
  } catch (err) {
    stream.markdown(
      `**Error:** ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── /context — Show or switch context ────────────────────────

async function cmdContext(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  bridge: AetherBridge,
): Promise<void> {
  const target = request.prompt.trim();

  if (!target) {
    // Show current context
    try {
      const result = await bridge.callTool("get_status", {});
      if (result) {
        const status = JSON.parse(result);
        stream.markdown(
          `**Active context:** ${status.activeContext ?? "default"}\n\n` +
            `**Available:** ${(status.contexts ?? []).join(", ")}`,
        );
      }
    } catch (err) {
      stream.markdown(
        `**Error:** ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // Switch context
  try {
    const result = await bridge.callTool("switch_context", { context: target });
    stream.markdown(result ?? `Switched to context: ${target}`);
  } catch (err) {
    stream.markdown(
      `**Error:** ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────

function renderResult(
  stream: vscode.ChatResponseStream,
  result: string | null,
): void {
  if (!result) {
    stream.markdown("No response from AETHER runtime.");
    return;
  }

  try {
    const parsed = JSON.parse(result);
    if (parsed.output) {
      stream.markdown(parsed.output);
    } else if (parsed.result) {
      stream.markdown(String(parsed.result));
    } else {
      stream.markdown("```json\n" + result + "\n```");
    }

    if (parsed.agentId) {
      stream.markdown(
        `\n\n---\n*Agent: **${parsed.agentId}** | Strategy: ${parsed.strategy ?? "auto"} | Confidence: ${parsed.confidence ?? "N/A"}*`,
      );
    }
  } catch {
    stream.markdown(result);
  }
}
