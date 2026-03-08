// ─────────────────────────────────────────────────────────────
// AETHER VS Code Extension — Entry Point
//
// Activates on startup or when .aether/ is detected.
// Registers commands, chat participant, sidebar views,
// status bar, and connects to the AETHER runtime via bridge.
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import { AetherBridge } from "./aether-bridge";
import { registerChatParticipant } from "./chat/participant";
import { AgentsTreeProvider } from "./sidebar/agents-tree";
import { TasksTreeProvider } from "./sidebar/tasks-tree";
import { ContextsTreeProvider } from "./sidebar/contexts-tree";
import { AetherStatusBar } from "./status/status-bar";
import { AetherCodeLensProvider } from "./editor/codelens";
import { AetherDiagnostics } from "./editor/diagnostics";
import { KnowledgeTreeProvider } from "./sidebar/knowledge-tree";
import { OrchestratorPanel } from "./panels/orchestrator";
import { CostDashboardPanel } from "./panels/task-history";
import { MemoryExplorerPanel } from "./panels/memory-explorer";
import { SettingsEditorPanel } from "./panels/settings-editor";

let bridge: AetherBridge | null = null;

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("AETHER");
  outputChannel.appendLine("AETHER extension activating...");

  // ── Resolve runtime path ─────────────────────────────────

  const config = vscode.workspace.getConfiguration("aether");
  let runtimePath = config.get<string>("runtimePath", "");

  if (!runtimePath) {
    // Auto-detect: look for .aether/ in workspace folders
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      for (const folder of folders) {
        const aetherDir = vscode.Uri.joinPath(folder.uri, ".aether");
        try {
          await vscode.workspace.fs.stat(aetherDir);
          runtimePath = folder.uri.fsPath;
          break;
        } catch {
          // No .aether/ here, try next folder
        }
      }
    }
  }

  // ── Initialize Bridge ────────────────────────────────────

  bridge = new AetherBridge(runtimePath, outputChannel);

  try {
    await bridge.connect();
    outputChannel.appendLine("Connected to AETHER runtime");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Failed to connect: ${msg}`);
    vscode.window.showWarningMessage(
      `AETHER: Could not connect to runtime. Some features will be unavailable. ${msg}`,
    );
  }

  // ── Status Bar ───────────────────────────────────────────

  const statusBar = new AetherStatusBar(bridge);
  context.subscriptions.push(statusBar);

  // ── Sidebar TreeViews ────────────────────────────────────

  const agentsTree = new AgentsTreeProvider(bridge);
  const tasksTree = new TasksTreeProvider(bridge);
  const contextsTree = new ContextsTreeProvider(bridge);
  const knowledgeTree = new KnowledgeTreeProvider(bridge);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("aether.agents", agentsTree),
    vscode.window.registerTreeDataProvider("aether.tasks", tasksTree),
    vscode.window.registerTreeDataProvider("aether.contexts", contextsTree),
    vscode.window.registerTreeDataProvider("aether.knowledge", knowledgeTree),
  );

  // ── CodeLens + Diagnostics ──────────────────────────────────
  const codeLensProvider = new AetherCodeLensProvider();
  const diagnostics = new AetherDiagnostics();

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      codeLensProvider,
    ),
    diagnostics,
  );

  // ── Chat Participant ─────────────────────────────────────

  registerChatParticipant(context, bridge);

  // ── Commands ─────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("aether.runTask", async () => {
      const description = await vscode.window.showInputBox({
        prompt: "Task description",
        placeHolder: "e.g. Add input validation to the login form",
      });
      if (description) {
        const result = await bridge?.callTool("submit_task", { description });
        if (result) {
          outputChannel.appendLine(`Task result: ${result}`);
          outputChannel.show();
        }
      }
    }),

    vscode.commands.registerCommand("aether.planTask", async () => {
      const description = await vscode.window.showInputBox({
        prompt: "Describe what you want to build",
        placeHolder: "e.g. User authentication with JWT tokens",
      });
      if (description) {
        const result = await bridge?.callTool("submit_task", {
          description: `Plan the following task (break into sub-tasks with agent assignments): ${description}`,
          target: "system-architect",
        });
        if (result) {
          outputChannel.appendLine(`Plan: ${result}`);
          outputChannel.show();
        }
      }
    }),

    vscode.commands.registerCommand("aether.showOrchestrator", () => {
      OrchestratorPanel.createOrShow(context, bridge!);
    }),

    vscode.commands.registerCommand("aether.showCosts", () => {
      CostDashboardPanel.createOrShow(context, bridge!);
    }),

    vscode.commands.registerCommand("aether.showMemory", () => {
      MemoryExplorerPanel.createOrShow(context, bridge!);
    }),

    vscode.commands.registerCommand("aether.showSettings", () => {
      SettingsEditorPanel.createOrShow(context, bridge!);
    }),

    vscode.commands.registerCommand("aether.switchContext", async () => {
      const result = await bridge?.callTool("get_status", {});
      if (!result) return;

      try {
        const status = JSON.parse(result);
        const contexts: string[] = status.contexts ?? ["default"];
        const picked = await vscode.window.showQuickPick(contexts, {
          placeHolder: `Current: ${status.activeContext ?? "default"}`,
        });
        if (picked) {
          await bridge?.callTool("switch_context", { context: picked });
          contextsTree.refresh();
          statusBar.refresh();
          vscode.window.showInformationMessage(
            `AETHER: Switched to context "${picked}"`,
          );
        }
      } catch {
        // Parsing failed — status wasn't valid JSON
      }
    }),

    vscode.commands.registerCommand("aether.refreshAgents", () => {
      agentsTree.refresh();
    }),

    vscode.commands.registerCommand(
      "aether.agentRunTask",
      async (item: { agentId?: string }) => {
        if (!item?.agentId) return;
        const description = await vscode.window.showInputBox({
          prompt: `Task for agent: ${item.agentId}`,
        });
        if (description) {
          const result = await bridge?.callTool("submit_task", {
            description,
            target: item.agentId,
          });
          if (result) {
            outputChannel.appendLine(`[${item.agentId}] ${result}`);
            outputChannel.show();
          }
        }
      },
    ),

    vscode.commands.registerCommand(
      "aether.agentDetail",
      async (item: { agentId?: string }) => {
        if (!item?.agentId) return;
        try {
          const result = await bridge?.readResource(
            `aether://agents/${item.agentId}`,
          );
          if (result) {
            const doc = await vscode.workspace.openTextDocument({
              content: JSON.stringify(JSON.parse(result), null, 2),
              language: "json",
            });
            await vscode.window.showTextDocument(doc, { preview: true });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          outputChannel.appendLine(`Agent detail error: ${msg}`);
        }
      },
    ),

    vscode.commands.registerCommand("aether.approveAll", () => {
      vscode.window.showInformationMessage(
        "AETHER: Approved all pending changes",
      );
      // TODO: Wire to approval manager
    }),

    vscode.commands.registerCommand("aether.rejectAll", () => {
      vscode.window.showInformationMessage(
        "AETHER: Rejected all pending changes",
      );
      // TODO: Wire to approval manager
    }),
  );

  outputChannel.appendLine("AETHER extension activated");
}

export function deactivate() {
  bridge?.disconnect();
  bridge = null;
}
