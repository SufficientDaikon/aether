// ─────────────────────────────────────────────────────────────
// Cost Dashboard Panel — Task history + cost breakdown
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

export class CostDashboardPanel {
  public static currentPanel: CostDashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    bridge: AetherBridge,
  ) {
    this.panel = panel;

    this.panel.webview.html = this.getHtml(panel.webview, extensionUri);

    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "getStatus") {
          const status = await bridge.callTool("get_status", {});
          this.panel.webview.postMessage({ type: "status", data: status });
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
    if (CostDashboardPanel.currentPanel) {
      CostDashboardPanel.currentPanel.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "aether.costs",
      "AETHER Costs",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );

    CostDashboardPanel.currentPanel = new CostDashboardPanel(
      panel,
      context.extensionUri,
      bridge,
    );
  }

  private dispose(): void {
    CostDashboardPanel.currentPanel = undefined;
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
  <title>AETHER Cost Dashboard</title>
  <style>
    body { margin: 0; padding: 16px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
  </style>
</head>
<body>
  <div id="root" data-view="costs"></div>
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
