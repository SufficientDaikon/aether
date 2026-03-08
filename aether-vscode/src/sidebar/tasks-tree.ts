// ─────────────────────────────────────────────────────────────
// Tasks TreeView — Active and recent tasks
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

interface TrackedTask {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  agentId?: string;
  startedAt: number;
}

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
      case "pending":
        this.iconPath = new vscode.ThemeIcon("clock");
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

  private tasks: TrackedTask[] = [];

  constructor(private bridge: AetherBridge) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  trackTask(id: string, description: string, agentId?: string): void {
    this.tasks.unshift({
      id,
      description,
      status: "running",
      agentId,
      startedAt: Date.now(),
    });
    // Keep last 50 tasks
    if (this.tasks.length > 50) this.tasks.length = 50;
    this._onDidChangeTreeData.fire(undefined);
  }

  completeTask(id: string, success: boolean): void {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      task.status = success ? "completed" : "failed";
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: TaskTreeItem): TaskTreeItem {
    return element;
  }

  getChildren(): TaskTreeItem[] {
    if (!this.tasks.length) {
      const item = new TaskTreeItem(
        "No active tasks",
        "Use @aether /run to start a task",
        "idle",
      );
      item.iconPath = new vscode.ThemeIcon("info");
      return [item];
    }

    return this.tasks.map((task) => {
      const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
      const desc = task.agentId
        ? `${task.agentId} (${elapsed}s)`
        : `${elapsed}s`;
      return new TaskTreeItem(task.description.slice(0, 60), desc, task.status);
    });
  }
}
