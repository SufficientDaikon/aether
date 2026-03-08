// ─────────────────────────────────────────────────────────────
// AETHER Chat Participant — @aether in VS Code Chat
//
// Registers a chat participant that routes user messages
// through AETHER's agent hierarchy via the bridge.
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";
import { handleSlashCommand } from "./commands";

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  bridge: AetherBridge,
): void {
  if (!vscode.chat?.createChatParticipant) {
    throw new Error("vscode.chat API not available");
  }
  const participant = vscode.chat.createChatParticipant(
    "aether.chat",
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ) => {
      // Handle slash commands
      if (request.command) {
        return handleSlashCommand(request, chatContext, stream, token, bridge);
      }

      // Default: route message as a task to best-fit agent
      if (!bridge.isConnected()) {
        stream.markdown(
          "**AETHER is not connected.** Make sure the runtime is installed and the workspace has a `.aether/` directory.",
        );
        return;
      }

      stream.progress("Routing to best-fit agent...");

      try {
        const result = await bridge.callTool("submit_task", {
          description: request.prompt,
        });

        if (token.isCancellationRequested) return;

        if (result) {
          // Try to parse as JSON for structured display
          try {
            const parsed = JSON.parse(result);
            if (parsed.output) {
              stream.markdown(parsed.output);
            } else if (parsed.result) {
              stream.markdown(String(parsed.result));
            } else {
              stream.markdown("```json\n" + result + "\n```");
            }

            // Show routing info if available
            if (parsed.agentId) {
              stream.markdown(
                `\n\n*Handled by **${parsed.agentId}** (${parsed.strategy ?? "auto-routed"})*`,
              );
            }
          } catch {
            stream.markdown(result);
          }
        } else {
          stream.markdown("No response from AETHER runtime.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stream.markdown(`**Error:** ${msg}`);
      }
    },
  );

  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "aether-icon.svg",
  );

  context.subscriptions.push(participant);
}
