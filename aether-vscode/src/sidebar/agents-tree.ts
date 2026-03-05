// ─────────────────────────────────────────────────────────────
// Agents TreeView — Sidebar agent registry grouped by tier
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

interface AgentInfo {
  id: string;
  name?: string;
  tier: string;
  sections?: string[];
  capabilities?: string[];
  status?: string;
}

class AgentTreeItem extends vscode.TreeItem {
  public agentId?: string;

  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    agentId?: string,
    tier?: string,
    status?: string,
  ) {
    super(label, collapsible);
    this.agentId = agentId;

    if (agentId) {
      this.contextValue = "agent";
      this.description = status ?? "unknown";
      this.tooltip = `${agentId} (${tier ?? "worker"}) — ${status ?? "unknown"}`;

      // Icon by tier
      switch (tier) {
        case "master":
          this.iconPath = new vscode.ThemeIcon(
            "star-full",
            new vscode.ThemeColor("charts.yellow"),
          );
          break;
        case "manager":
          this.iconPath = new vscode.ThemeIcon(
            "organization",
            new vscode.ThemeColor("charts.blue"),
          );
          break;
        default:
          this.iconPath = new vscode.ThemeIcon(
            "person",
            new vscode.ThemeColor("charts.green"),
          );
      }
    } else {
      // Group header
      this.iconPath = new vscode.ThemeIcon("folder");
    }
  }
}

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    AgentTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private agents: AgentInfo[] = [];

  constructor(private bridge: AetherBridge) {
    this.loadAgents();
  }

  refresh(): void {
    this.loadAgents();
  }

  private async loadAgents(): Promise<void> {
    try {
      const result = await this.bridge.readResource("aether://agents");
      if (result) {
        this.agents = JSON.parse(result);
      }
    } catch {
      this.agents = [];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: AgentTreeItem): AgentTreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): AgentTreeItem[] {
    if (!element) {
      // Root: tier groups
      const masters = this.agents.filter((a) => a.tier === "master");
      const managers = this.agents.filter((a) => a.tier === "manager");
      const workers = this.agents.filter((a) => a.tier === "worker");

      const items: AgentTreeItem[] = [];
      if (masters.length) {
        items.push(
          new AgentTreeItem(
            `Master (${masters.length})`,
            vscode.TreeItemCollapsibleState.Expanded,
          ),
        );
      }
      if (managers.length) {
        items.push(
          new AgentTreeItem(
            `Managers (${managers.length})`,
            vscode.TreeItemCollapsibleState.Expanded,
          ),
        );
      }
      if (workers.length) {
        items.push(
          new AgentTreeItem(
            `Workers (${workers.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
          ),
        );
      }

      if (!items.length) {
        const empty = new AgentTreeItem(
          "No agents loaded",
          vscode.TreeItemCollapsibleState.None,
        );
        empty.iconPath = new vscode.ThemeIcon("info");
        return [empty];
      }

      return items;
    }

    // Children: agents in that tier group
    const label = element.label as string;
    let tier: string;
    if (label.startsWith("Master")) tier = "master";
    else if (label.startsWith("Manager")) tier = "manager";
    else tier = "worker";

    return this.agents
      .filter((a) => a.tier === tier)
      .map(
        (a) =>
          new AgentTreeItem(
            a.name ?? a.id,
            vscode.TreeItemCollapsibleState.None,
            a.id,
            a.tier,
            a.status,
          ),
      );
  }
}
