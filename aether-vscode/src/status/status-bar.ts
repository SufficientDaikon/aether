// ─────────────────────────────────────────────────────────────
// AETHER Status Bar — Shows agent status + cost in status bar
// ─────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import type { AetherBridge } from "../aether-bridge";

export class AetherStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private bridge: AetherBridge;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(bridge: AetherBridge) {
    this.bridge = bridge;
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = "aether.showOrchestrator";
    this.item.tooltip = "AETHER Agent Orchestrator";
    this.update();
    this.item.show();

    // Poll every 10 seconds
    this.timer = setInterval(() => this.update(), 10_000);
  }

  refresh(): void {
    this.update();
  }

  private async update(): Promise<void> {
    if (!this.bridge.isConnected()) {
      this.item.text = "$(circle-slash) AETHER";
      this.item.tooltip = "AETHER: Not connected";
      return;
    }

    try {
      const result = await this.bridge.callTool("get_status", {});
      if (!result) {
        this.item.text = "$(pulse) AETHER";
        return;
      }

      const status = JSON.parse(result);
      const total = status.agents?.total ?? 0;
      const busy = status.agents?.busy ?? 0;
      const ctx = status.activeContext ?? "default";

      if (busy > 0) {
        this.item.text = `$(sync~spin) AETHER | ${busy} active | ${ctx}`;
      } else {
        this.item.text = `$(pulse) AETHER | ${total} agents | ${ctx}`;
      }

      this.item.tooltip = [
        `Agents: ${total} (${busy} busy)`,
        `Context: ${ctx}`,
        `Contexts: ${(status.contexts ?? []).join(", ")}`,
        status.cacheStats ? `Cache: ${status.cacheStats.hits ?? 0} hits` : null,
      ]
        .filter(Boolean)
        .join("\n");
    } catch {
      this.item.text = "$(pulse) AETHER";
    }
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.item.dispose();
  }
}
