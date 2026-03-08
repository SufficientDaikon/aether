// DashboardPanelManager — Single unified webview panel for AETHER
//
// Consolidates the 4 separate panels into one tabbed dashboard.
// Handles RPC messages from webview and routes to AetherBridge.

import * as vscode from "vscode";
import * as crypto from "node:crypto";
import type { AetherBridge } from "../aether-bridge";

interface WebviewRequest {
  id: string;
  type: "request";
  method: string;
  params?: any;
  timestamp: number;
}

export class DashboardPanelManager {
  private panel?: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private bridge: AetherBridge,
  ) {}

  show(initialTab?: string): void {
    if (this.panel) {
      this.panel.reveal();
      if (initialTab) {
        this.postMessage({ type: "navigate", tab: initialTab });
      }
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "aether.dashboard",
      "AETHER Dashboard",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        ],
      },
    );

    this.panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "media",
      "aether-icon.svg",
    );

    this.setupWebview(initialTab);
  }

  restore(panel: vscode.WebviewPanel, _state: any): void {
    this.panel = panel;
    this.setupWebview();
  }

  private setupWebview(initialTab?: string): void {
    if (!this.panel) return;

    this.panel.webview.html = this.getWebviewContent();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    });

    if (initialTab) {
      const readyListener = this.panel.webview.onDidReceiveMessage((msg) => {
        if (msg.type === "ready") {
          this.postMessage({ type: "navigate", tab: initialTab });
          readyListener.dispose();
        }
      });
      this.disposables.push(readyListener);
    }
  }

  private async handleMessage(message: any): Promise<void> {
    if (message.type === "ready") return;
    if (message.type !== "request") return;

    const request = message as WebviewRequest;

    try {
      const result = await this.executeRPC(request.method, request.params);
      this.postMessage({
        type: "response",
        id: `resp_${Date.now()}`,
        correlationId: request.id,
        result,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      this.postMessage({
        type: "response",
        id: `resp_${Date.now()}`,
        correlationId: request.id,
        error: { code: -1, message: error?.message || "Unknown error" },
        timestamp: Date.now(),
      });
    }
  }

  private async executeRPC(method: string, params?: any): Promise<any> {
    switch (method) {
      case "getSystemStatus":
        return this.getSystemStatus();
      case "getAgents":
        return this.getAgents(params);
      case "getTasks":
        return this.getTasks();
      case "submitTask":
        return this.submitTask(params);
      case "cancelTask":
        return this.bridgeCall("submit_task", {
          description: `Cancel task ${params?.taskId}`,
          target: "cortex-0",
        });
      case "retryTask":
        return this.bridgeCall("submit_task", {
          description: `Retry task ${params?.taskId}`,
          target: "cortex-0",
        });
      case "sendChatMessage":
        return this.sendChatMessage(params);
      case "getPendingApprovals":
        return this.getPendingApprovals();
      case "approveChange":
        return this.approveChange(params);
      case "rejectChange":
        return this.rejectChange(params);
      case "batchApprove":
        return this.batchApprove(params);
      case "searchMemory":
        return this.searchMemory(params);
      case "getConfig":
        return this.getConfig();
      case "updateConfig":
        return this.updateConfig(params);
      case "applyCodeBlock":
        return { success: true };
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  // ── RPC Implementations ────────────────────────────────────

  private async getSystemStatus() {
    const raw = await this.bridge.callTool("get_status", {});
    if (!raw) return this.defaultStatus();
    try {
      const data = JSON.parse(raw);
      return {
        agents: {
          total: data.agents?.total ?? 34,
          online: data.agents?.online ?? data.agents?.total ?? 34,
          busy: data.agents?.busy ?? 0,
          offline: data.agents?.offline ?? 0,
        },
        tasks: {
          active: data.tasks?.active ?? 0,
          queued: data.tasks?.queued ?? 0,
          completed: data.tasks?.completed ?? 0,
          failed: data.tasks?.failed ?? 0,
        },
        memory: {
          used: data.memory?.used ?? 0,
          available: data.memory?.available ?? 1073741824,
          cacheHits: data.cacheStats?.hits ?? 0,
          cacheMisses: data.cacheStats?.misses ?? 0,
        },
        cost: {
          today: data.cost?.today ?? 0,
          thisMonth: data.cost?.thisMonth ?? 0,
          lastMonth: data.cost?.lastMonth ?? 0,
        },
        uptime: data.uptime ?? 0,
        version: data.version ?? "0.2.0",
      };
    } catch {
      return this.defaultStatus();
    }
  }

  private async getAgents(params?: any) {
    const raw = await this.bridge.readResource("aether://agents");
    if (!raw) return [];
    try {
      const agents = JSON.parse(raw);
      if (!Array.isArray(agents)) return [];
      return agents.map((a: any) => ({
        id: a.id,
        name: a.name || a.id,
        tier: a.tier || "worker",
        status: a.status || "online",
        capabilities: a.capabilities || a.sections || [],
        currentTask: a.currentTask || undefined,
        completedTasks: a.completedTasks ?? 0,
        avgResponseTime: a.avgResponseTime ?? 0,
        lastSeen: a.lastSeen || new Date().toISOString(),
        parent: a.parent,
        children: a.children || [],
      }));
    } catch {
      return [];
    }
  }

  private async getTasks() {
    // Tasks aren't directly exposed as a resource yet; return from status
    return [];
  }

  private async submitTask(params: any) {
    const result = await this.bridge.callTool("submit_task", {
      description: params.description,
      target: params.targetAgent,
    });
    return { success: true, result };
  }

  private async sendChatMessage(params: any) {
    const message = params.command
      ? `/${params.command} ${params.message}`
      : params.message;

    const result = await this.bridge.callTool("submit_task", {
      description: message,
    });

    return {
      id: `resp_${Date.now()}`,
      role: "assistant",
      content: result || "Task submitted successfully.",
      timestamp: new Date().toISOString(),
      agent: "cortex-0",
      command: params.command,
    };
  }

  private async searchMemory(params: any) {
    const result = await this.bridge.callTool("search_memory", {
      query: params.query,
      limit: params.limit ?? 20,
    });
    if (!result) return [];
    try {
      const data = JSON.parse(result);
      return Array.isArray(data)
        ? data.map((r: any, i: number) => ({
            id: `mem_${i}`,
            type: r.type || "embedding",
            content: r.text || r.content || "",
            score: r.score ?? 0,
            source: r.source || r.namespace || "unknown",
            timestamp: r.timestamp || new Date().toISOString(),
            agent: r.agent,
          }))
        : [];
    } catch {
      return [];
    }
  }

  private async getConfig() {
    const result = await this.bridge.readResource("aether://settings");
    if (!result) return {};
    try {
      return JSON.parse(result);
    } catch {
      return {};
    }
  }

  private async updateConfig(params: any) {
    await this.bridge.callTool("submit_task", {
      description: `Update configuration: ${params.section} = ${JSON.stringify(params.updates)}`,
    });
    return { success: true };
  }

  private async getPendingApprovals() {
    try {
      const raw = await this.bridge.callTool("get_status", {});
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data.pendingApprovals) ? data.pendingApprovals : [];
    } catch {
      return [];
    }
  }

  private async approveChange(params: any) {
    try {
      await this.bridge.callTool("submit_task", {
        description: `Approve change: ${params.approvalId}`,
        target: "cortex-0",
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  }

  private async rejectChange(params: any) {
    try {
      await this.bridge.callTool("submit_task", {
        description: `Reject change: ${params.approvalId} — Reason: ${params.reason || "Rejected via dashboard"}`,
        target: "cortex-0",
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  }

  private async batchApprove(params: any) {
    const ids = params.approvalIds || [];
    try {
      for (const id of ids) {
        await this.bridge.callTool("submit_task", {
          description: `Approve change: ${id}`,
          target: "cortex-0",
        });
      }
      return { success: true, approved: ids.length };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private async bridgeCall(tool: string, args: Record<string, unknown>) {
    const result = await this.bridge.callTool(tool, args);
    return result ? JSON.parse(result) : null;
  }

  private defaultStatus() {
    return {
      agents: { total: 0, online: 0, busy: 0, offline: 0 },
      tasks: { active: 0, queued: 0, completed: 0, failed: 0 },
      memory: { used: 0, available: 0, cacheHits: 0, cacheMisses: 0 },
      cost: { today: 0, thisMonth: 0, lastMonth: 0 },
      uptime: 0,
      version: "0.2.0",
    };
  }

  private postMessage(message: any): void {
    this.panel?.webview.postMessage(message);
  }

  private getWebviewContent(): string {
    if (!this.panel) return "";

    const webview = this.panel.webview;
    const distUri = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, "webview.js"),
    );
    const nonce = crypto.randomBytes(16).toString("hex");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: https:; font-src data:;">
  <title>AETHER Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
