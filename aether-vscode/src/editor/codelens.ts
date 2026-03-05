// ─────────────────────────────────────────────────────────────
// CodeLens Provider — "Ask Agent" / "Explain" / "Test" lenses
// above functions and classes
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";

export class AetherCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match function/method declarations across common languages
      const isFunction =
        /^\s*(export\s+)?(async\s+)?function\s+\w+/.test(line) ||
        /^\s*(public|private|protected|static|async)\s+[\w<>]+\s*\(/.test(
          line,
        ) ||
        /^\s*def\s+\w+/.test(line) ||
        /^\s*fn\s+\w+/.test(line);

      const isClass =
        /^\s*(export\s+)?(abstract\s+)?class\s+\w+/.test(line) ||
        /^\s*struct\s+\w+/.test(line);

      if (isFunction || isClass) {
        const range = new vscode.Range(i, 0, i, line.length);

        lenses.push(
          new vscode.CodeLens(range, {
            title: "Ask Agent",
            command: "aether.runTask",
            tooltip: "Submit a task about this code to AETHER",
          }),
        );

        if (isFunction) {
          lenses.push(
            new vscode.CodeLens(range, {
              title: "Test",
              command: "aether.runTask",
              tooltip: "Generate tests for this function",
            }),
          );
        }
      }
    }

    return lenses;
  }
}
