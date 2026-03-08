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
import { AetherSidebarProvider } from "./sidebar/sidebar-provider";
import { AetherStatusBar } from "./status/status-bar";
import { AetherCodeLensProvider } from "./editor/codelens";
import { AetherDiagnostics } from "./editor/diagnostics";
import { OrchestratorPanel } from "./panels/orchestrator";
import { CostDashboardPanel } from "./panels/task-history";
import { MemoryExplorerPanel } from "./panels/memory-explorer";
import { SettingsEditorPanel } from "./panels/settings-editor";
import { DashboardPanelManager } from "./panels/dashboard-panel-manager";

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

  // ── Sidebar WebviewView ──────────────────────────────────

  const sidebarProvider = new AetherSidebarProvider(context, bridge!);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AetherSidebarProvider.viewId,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
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

  try {
    registerChatParticipant(context, bridge);
  } catch (err) {
    // vscode.chat may be unavailable if Copilot Chat extension is not active
    outputChannel.appendLine(
      `Chat participant unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Dashboard ──────────────────────────────────────────────

  const dashboardManager = new DashboardPanelManager(context, bridge!);

  context.subscriptions.push(
    vscode.commands.registerCommand("aether.dashboard", () => {
      dashboardManager.show();
      sidebarProvider.reveal();
    }),
    vscode.commands.registerCommand("aether.dashboard.overview", () => {
      dashboardManager.show("overview");
    }),
    vscode.commands.registerCommand("aether.dashboard.agents", () => {
      dashboardManager.show("agents");
    }),
    vscode.commands.registerCommand("aether.dashboard.tasks", () => {
      dashboardManager.show("tasks");
    }),
    vscode.commands.registerCommand("aether.dashboard.chat", () => {
      dashboardManager.show("chat");
    }),
    vscode.commands.registerCommand("aether.dashboard.approvals", () => {
      dashboardManager.show("approvals");
    }),
    vscode.commands.registerCommand("aether.dashboard.memory", () => {
      dashboardManager.show("memory");
    }),
    vscode.commands.registerCommand("aether.dashboard.settings", () => {
      dashboardManager.show("settings");
    }),
  );

  // Register serializer for dashboard persistence
  vscode.window.registerWebviewPanelSerializer("aether.dashboard", {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
      dashboardManager.restore(panel, state);
    },
  });

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
          statusBar.refresh();
          vscode.window.showInformationMessage(
            `AETHER: Switched to context "${picked}"`,
          );
        }
      } catch {
        // Parsing failed — status wasn't valid JSON
      }
    }),

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
