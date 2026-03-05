// ─────────────────────────────────────────────────────────────
// Memory Explorer Panel — RAG search + entity browser
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

export class MemoryExplorerPanel {
  public static currentPanel: MemoryExplorerPanel | undefined;
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
        if (msg.type === "search") {
          const result = await bridge.callTool("search_memory", {
            query: msg.query,
            topK: msg.topK ?? 10,
          });
          this.panel.webview.postMessage({
            type: "searchResults",
            data: result,
          });
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
    if (MemoryExplorerPanel.currentPanel) {
      MemoryExplorerPanel.currentPanel.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "aether.memory",
      "AETHER Memory Explorer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );

    MemoryExplorerPanel.currentPanel = new MemoryExplorerPanel(
      panel,
      context.extensionUri,
      bridge,
    );
  }

  private dispose(): void {
    MemoryExplorerPanel.currentPanel = undefined;
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
  <title>AETHER Memory Explorer</title>
  <style>
    body { margin: 0; padding: 16px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
  </style>
</head>
<body>
  <div id="root" data-view="memory"></div>
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
