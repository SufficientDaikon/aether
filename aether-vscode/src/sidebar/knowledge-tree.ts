// ─────────────────────────────────────────────────────────────
// Knowledge TreeView — RAG memory + entity browser sidebar
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

class KnowledgeTreeItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class KnowledgeTreeProvider implements vscode.TreeDataProvider<KnowledgeTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    KnowledgeTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: Array<{ label: string; description: string; icon: string }> =
    [];

  constructor(private bridge: AetherBridge) {
    this.loadKnowledge();
  }

  refresh(): void {
    this.loadKnowledge();
  }

  private async loadKnowledge(): Promise<void> {
    try {
      const result = await this.bridge.callTool("get_status", {});
      if (result) {
        const status = JSON.parse(result);
        this.items = [
          {
            label: "RAG Index",
            description: status.ragAvailable ? "Active" : "Inactive",
            icon: status.ragAvailable ? "database" : "circle-slash",
          },
          {
            label: "Documents",
            description: `${status.ragDocCount ?? 0} indexed`,
            icon: "file-text",
          },
          {
            label: "Entities",
            description: `${status.entityCount ?? 0} tracked`,
            icon: "symbol-class",
          },
          {
            label: "Cache",
            description: `${status.cacheStats?.hits ?? 0} hits / ${status.cacheStats?.misses ?? 0} misses`,
            icon: "archive",
          },
        ];
      }
    } catch {
      this.items = [
        {
          label: "Knowledge unavailable",
          description: "Connect to runtime",
          icon: "info",
        },
      ];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: KnowledgeTreeItem): KnowledgeTreeItem {
    return element;
  }

  getChildren(): KnowledgeTreeItem[] {
    if (!this.items.length) {
      return [new KnowledgeTreeItem("No data", "Connect to runtime", "info")];
    }
    return this.items.map(
      (item) => new KnowledgeTreeItem(item.label, item.description, item.icon),
    );
  }
}
