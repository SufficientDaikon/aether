// ─────────────────────────────────────────────────────────────
// Tasks TreeView — Active and recent tasks
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

class TaskTreeItem extends vscode.TreeItem {
  constructor(label: string, description: string, status: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;

    switch (status) {
      case "running":
        this.iconPath = new vscode.ThemeIcon(
          "sync~spin",
          new vscode.ThemeColor("charts.blue"),
        );
        break;
      case "completed":
        this.iconPath = new vscode.ThemeIcon(
          "check",
          new vscode.ThemeColor("charts.green"),
        );
        break;
      case "failed":
        this.iconPath = new vscode.ThemeIcon(
          "error",
          new vscode.ThemeColor("charts.red"),
        );
        break;
      default:
        this.iconPath = new vscode.ThemeIcon("circle-outline");
    }
  }
}

export class TasksTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TaskTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private bridge: AetherBridge) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TaskTreeItem): TaskTreeItem {
    return element;
  }

  getChildren(): TaskTreeItem[] {
    // Tasks will be populated as they are submitted through the bridge
    // For now, show a placeholder
    const item = new TaskTreeItem(
      "No active tasks",
      "Use @aether /run to start a task",
      "idle",
    );
    item.iconPath = new vscode.ThemeIcon("info");
    return [item];
  }
}
