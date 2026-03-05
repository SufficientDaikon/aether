// ─────────────────────────────────────────────────────────────
// Contexts TreeView — Namespace management sidebar
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

class ContextTreeItem extends vscode.TreeItem {
  constructor(name: string, isActive: boolean) {
    super(name, vscode.TreeItemCollapsibleState.None);

    if (isActive) {
      this.description = "(active)";
      this.iconPath = new vscode.ThemeIcon(
        "check",
        new vscode.ThemeColor("charts.green"),
      );
    } else {
      this.iconPath = new vscode.ThemeIcon("layers");
    }

    this.command = {
      command: "aether.switchContext",
      title: "Switch Context",
    };
    this.contextValue = "context";
  }
}

export class ContextsTreeProvider implements vscode.TreeDataProvider<ContextTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ContextTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private contexts: string[] = ["default"];
  private activeContext = "default";

  constructor(private bridge: AetherBridge) {
    this.loadContexts();
  }

  refresh(): void {
    this.loadContexts();
  }

  private async loadContexts(): Promise<void> {
    try {
      const result = await this.bridge.callTool("get_status", {});
      if (result) {
        const status = JSON.parse(result);
        this.contexts = status.contexts ?? ["default"];
        this.activeContext = status.activeContext ?? "default";
      }
    } catch {
      // Keep defaults
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ContextTreeItem): ContextTreeItem {
    return element;
  }

  getChildren(): ContextTreeItem[] {
    return this.contexts.map(
      (name) => new ContextTreeItem(name, name === this.activeContext),
    );
  }
}
