// ─────────────────────────────────────────────────────────────
// Orchestrator Panel — Main webview for agent graph + task flow
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

export class OrchestratorPanel {
  public static currentPanel: OrchestratorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly bridge: AetherBridge;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    bridge: AetherBridge,
  ) {
    this.panel = panel;
    this.bridge = bridge;

    this.panel.webview.html = this.getHtml(panel.webview, extensionUri);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "getAgents": {
            const agents = await bridge.readResource("aether://agents");
            this.panel.webview.postMessage({ type: "agents", data: agents });
            break;
          }
          case "getStatus": {
            const status = await bridge.callTool("get_status", {});
            this.panel.webview.postMessage({ type: "status", data: status });
            break;
          }
          case "runTask": {
            const result = await bridge.callTool("submit_task", msg.payload);
            this.panel.webview.postMessage({
              type: "taskResult",
              data: result,
            });
            break;
          }
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    bridge: AetherBridge,
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (OrchestratorPanel.currentPanel) {
      OrchestratorPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "aether.orchestrator",
      "AETHER Orchestrator",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist"),
          vscode.Uri.joinPath(context.extensionUri, "media"),
        ],
      },
    );

    OrchestratorPanel.currentPanel = new OrchestratorPanel(
      panel,
      context.extensionUri,
      bridge,
    );
  }

  private dispose(): void {
    OrchestratorPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <title>AETHER Orchestrator</title>
  <style>
    body { margin: 0; padding: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
  </style>
</head>
<body>
  <div id="root" data-view="orchestrator"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
