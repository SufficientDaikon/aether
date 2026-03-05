// ─────────────────────────────────────────────────────────────
// AETHER Webview UI — Main entry point
//
// This runs inside VS Code webview iframes. It reads the
// data-view attribute from the root div to determine which
// view to render (orchestrator, costs, memory, settings).
// ─────────────────────────────────────────────────────────────

// Minimal React-free implementation to avoid bundling React
// into the extension. Uses vanilla DOM for webview panels.

const vscode = acquireVsCodeApi();

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// ── Router ───────────────────────────────────────────────────

function init(): void {
  const root = document.getElementById("root");
  if (!root) return;

  const view = root.dataset.view;

  switch (view) {
    case "orchestrator":
      renderOrchestrator(root);
      break;
    case "costs":
      renderCosts(root);
      break;
    case "memory":
      renderMemory(root);
      break;
    case "settings":
      renderSettings(root);
      break;
    default:
      root.innerHTML = `<p>Unknown view: ${view}</p>`;
  }
}

// ── Orchestrator View ────────────────────────────────────────

function renderOrchestrator(root: HTMLElement): void {
  root.innerHTML = `
    <div style="padding: 16px;">
      <h2 style="margin-top:0;">Agent Orchestrator</h2>
      <div id="agent-graph" style="border: 1px solid var(--vscode-panel-border); border-radius: 4px; min-height: 400px; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground);">
        Loading agents...
      </div>
      <div id="agent-list" style="margin-top: 16px;"></div>
    </div>
  `;

  vscode.postMessage({ type: "getAgents" });
  vscode.postMessage({ type: "getStatus" });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "agents" && msg.data) {
      renderAgentGraph(msg.data);
    }
    if (msg.type === "status" && msg.data) {
      renderStatusBadge(msg.data);
    }
  });
}

function renderAgentGraph(data: string): void {
  const container = document.getElementById("agent-graph");
  if (!container) return;

  try {
    const agents = JSON.parse(data) as Array<{
      id: string;
      name?: string;
      tier: string;
      status?: string;
      sections?: string[];
    }>;

    if (!agents.length) {
      container.innerHTML = "<p>No agents registered</p>";
      return;
    }

    // Group by tier
    const tiers: Record<string, typeof agents> = {
      master: [],
      manager: [],
      worker: [],
    };
    for (const a of agents) {
      (tiers[a.tier] ?? tiers.worker).push(a);
    }

    const tierColors: Record<string, string> = {
      master: "#f5a623",
      manager: "#4a9eff",
      worker: "#5cb85c",
    };

    // Create SVG visualization
    const width = container.clientWidth || 600;
    const height = 400;

    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

    // Render tiers as rows
    const tierNames = ["master", "manager", "worker"];
    tierNames.forEach((tier, tierIdx) => {
      const tierAgents = tiers[tier];
      if (!tierAgents.length) return;

      const y = 40 + tierIdx * 130;
      const color = tierColors[tier];

      // Tier label
      svg += `<text x="10" y="${y}" fill="${color}" font-size="14" font-weight="bold">${tier.toUpperCase()} (${tierAgents.length})</text>`;

      // Agent nodes
      tierAgents.forEach((agent, i) => {
        const x = 20 + i * 120;
        const nodeY = y + 20;
        const isActive = agent.status === "busy";

        svg += `<rect x="${x}" y="${nodeY}" width="100" height="60" rx="6" fill="${isActive ? color + "40" : "var(--vscode-editor-background)"}" stroke="${color}" stroke-width="${isActive ? 2 : 1}"/>`;
        svg += `<text x="${x + 50}" y="${nodeY + 25}" fill="var(--vscode-editor-foreground)" font-size="10" text-anchor="middle">${agent.name ?? agent.id}</text>`;
        svg += `<text x="${x + 50}" y="${nodeY + 42}" fill="var(--vscode-descriptionForeground)" font-size="9" text-anchor="middle">${agent.status ?? "idle"}</text>`;

        if (isActive) {
          svg += `<circle cx="${x + 90}" cy="${nodeY + 10}" r="4" fill="${color}"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/></circle>`;
        }
      });
    });

    svg += `</svg>`;
    container.innerHTML = svg;
  } catch {
    container.innerHTML = "<p>Failed to render agent graph</p>";
  }
}

function renderStatusBadge(data: string): void {
  try {
    const status = JSON.parse(data);
    const list = document.getElementById("agent-list");
    if (!list) return;

    list.innerHTML = `
      <div style="display: flex; gap: 16px; flex-wrap: wrap;">
        <div style="padding: 8px 16px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);">
          Agents: ${status.agents?.total ?? 0}
        </div>
        <div style="padding: 8px 16px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);">
          Context: ${status.activeContext ?? "default"}
        </div>
        <div style="padding: 8px 16px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);">
          RAG: ${status.ragAvailable ? "Active" : "Off"}
        </div>
      </div>
    `;
  } catch {
    // ignore
  }
}

// ── Cost Dashboard View ──────────────────────────────────────

function renderCosts(root: HTMLElement): void {
  root.innerHTML = `
    <h2 style="margin-top:0;">Cost Dashboard</h2>
    <p style="color: var(--vscode-descriptionForeground);">Token usage and cost tracking per agent, per tier, and per task.</p>
    <div id="cost-data" style="margin-top: 16px;">
      <p>Loading...</p>
    </div>
  `;

  vscode.postMessage({ type: "getStatus" });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "status" && msg.data) {
      const container = document.getElementById("cost-data");
      if (!container) return;
      try {
        const status = JSON.parse(msg.data);
        container.innerHTML = `
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid var(--vscode-panel-border);">
              <th style="text-align: left; padding: 8px;">Metric</th>
              <th style="text-align: right; padding: 8px;">Value</th>
            </tr>
            <tr><td style="padding: 8px;">Total Agents</td><td style="text-align: right; padding: 8px;">${status.agents?.total ?? 0}</td></tr>
            <tr><td style="padding: 8px;">Active</td><td style="text-align: right; padding: 8px;">${status.agents?.busy ?? 0}</td></tr>
            <tr><td style="padding: 8px;">Cache Hits</td><td style="text-align: right; padding: 8px;">${status.cacheStats?.hits ?? 0}</td></tr>
            <tr><td style="padding: 8px;">Cache Misses</td><td style="text-align: right; padding: 8px;">${status.cacheStats?.misses ?? 0}</td></tr>
          </table>
          <p style="margin-top: 16px; color: var(--vscode-descriptionForeground); font-size: 12px;">
            Per-task cost tracking will populate as tasks are executed.
          </p>
        `;
      } catch {
        container.innerHTML = "<p>Failed to load data</p>";
      }
    }
  });
}

// ── Memory Explorer View ─────────────────────────────────────

function renderMemory(root: HTMLElement): void {
  root.innerHTML = `
    <h2 style="margin-top:0;">Memory Explorer</h2>
    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
      <input id="memory-query" type="text" placeholder="Search agent memory..."
        style="flex: 1; padding: 6px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; font-family: var(--vscode-font-family);" />
      <button id="memory-search" style="padding: 6px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer;">
        Search
      </button>
    </div>
    <div id="memory-results"></div>
  `;

  const searchBtn = document.getElementById("memory-search");
  const queryInput = document.getElementById(
    "memory-query",
  ) as HTMLInputElement;

  searchBtn?.addEventListener("click", () => {
    const query = queryInput?.value?.trim();
    if (query) {
      vscode.postMessage({ type: "search", query, topK: 10 });
      const results = document.getElementById("memory-results");
      if (results) results.innerHTML = "<p>Searching...</p>";
    }
  });

  queryInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchBtn?.click();
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "searchResults" && msg.data) {
      const container = document.getElementById("memory-results");
      if (!container) return;
      try {
        const results = JSON.parse(msg.data);
        if (!Array.isArray(results) || !results.length) {
          container.innerHTML = "<p>No results found.</p>";
          return;
        }

        container.innerHTML = results
          .map(
            (
              r: {
                text?: string;
                score?: string;
                namespace?: string;
                source?: string;
              },
              i: number,
            ) => `
          <div style="padding: 12px; margin-bottom: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-weight: bold;">#${i + 1}</span>
              <span style="color: var(--vscode-descriptionForeground); font-size: 12px;">
                Score: ${r.score ?? "?"} | ${r.namespace ?? "unknown"}
              </span>
            </div>
            <p style="margin: 0; white-space: pre-wrap; font-size: 13px;">${escapeHtml(r.text ?? "")}</p>
          </div>
        `,
          )
          .join("");
      } catch {
        container.innerHTML = "<p>Failed to parse results</p>";
      }
    }
  });
}

// ── Settings View ────────────────────────────────────────────

function renderSettings(root: HTMLElement): void {
  root.innerHTML = `
    <h2 style="margin-top:0;">AETHER Settings</h2>
    <p style="color: var(--vscode-descriptionForeground);">Visual editor for settings.json (13 subsystem groups)</p>
    <div id="settings-data" style="margin-top: 16px;">
      <p>Loading...</p>
    </div>
  `;

  vscode.postMessage({ type: "getSettings" });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "settings" && msg.data) {
      const container = document.getElementById("settings-data");
      if (!container) return;
      try {
        const settings = JSON.parse(msg.data);
        const groups = Object.keys(settings);

        container.innerHTML = groups
          .map(
            (group) => `
          <details style="margin-bottom: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px;">
            <summary style="padding: 10px 14px; cursor: pointer; font-weight: bold; background: var(--vscode-sideBar-background);">
              ${group}
            </summary>
            <div style="padding: 12px;">
              <pre style="margin: 0; font-size: 12px; white-space: pre-wrap;">${escapeHtml(JSON.stringify(settings[group], null, 2))}</pre>
            </div>
          </details>
        `,
          )
          .join("");
      } catch {
        container.innerHTML = "<p>Failed to parse settings</p>";
      }
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Boot ─────────────────────────────────────────────────────

init();
