// ─────────────────────────────────────────────────────────────
// Diagnostics — Agent-generated warnings/suggestions
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";

export class AetherDiagnostics implements vscode.Disposable {
  private collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("aether");
  }

  /**
   * Add diagnostics for a file from agent analysis.
   */
  setDiagnostics(
    uri: vscode.Uri,
    items: Array<{
      line: number;
      message: string;
      severity: "error" | "warning" | "info" | "hint";
    }>,
  ): void {
    const diagnostics = items.map((item) => {
      const range = new vscode.Range(item.line, 0, item.line, 1000);
      const severity =
        item.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : item.severity === "warning"
            ? vscode.DiagnosticSeverity.Warning
            : item.severity === "info"
              ? vscode.DiagnosticSeverity.Information
              : vscode.DiagnosticSeverity.Hint;

      const diag = new vscode.Diagnostic(range, item.message, severity);
      diag.source = "AETHER";
      return diag;
    });

    this.collection.set(uri, diagnostics);
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.collection.delete(uri);
    } else {
      this.collection.clear();
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}
