# AETHER — Multi-Agent Orchestrator for VS Code

**34 specialized AI agents. 3-tier hierarchy. One unified dashboard.**

AETHER transforms VS Code into a command center for multi-agent AI orchestration. Route tasks to specialized agents, visualize agent hierarchies, manage approvals, track costs, and chat with your AI team — all from a single dashboard.

## ✨ Features

### 🎯 Unified Dashboard (`Ctrl+Shift+A`)

One tabbed interface replaces scattered panels:

- **Overview** — System health, cost tracking with sparklines, quick actions
- **Agents** — Interactive SVG hierarchy graph with tier visualization (Master → Manager → Worker)
- **Tasks** — Mission control with progress tracking and subtask trees
- **Chat** — Full chat with markdown rendering, syntax highlighting, and /slash commands
- **Approvals** — Review pending changes with inline diffs, batch approve/reject
- **Memory** — RAG search with type filters across conversation history
- **Settings** — Visual configuration editor for all 13 AETHER subsystems

### 🤖 34 Specialized Agents

- **Master tier**: `cortex-0` — Strategic orchestration and task decomposition
- **Manager tier**: System Architect, Product Visionary, Cyber Sentinel, QA Director, Marketing Lead
- **Worker tier**: React Specialist, Postgres Architect, Playwright Tester, CLI Wizard, and 20+ more

### 💬 Chat Integration

- 9 slash commands: `/run`, `/plan`, `/review`, `/test`, `/debug`, `/architect`, `/group`, `/status`, `/context`
- Full markdown rendering with Prism.js syntax highlighting
- Code block "Apply" buttons to insert changes into files
- Agent-attributed responses

### 📊 Agent Hierarchy Visualization

- Interactive SVG graph with zoom, pan, and click-to-select
- Animated flow particles on selected connections
- Pulse indicators for busy agents
- Color-coded tiers: Gold (Master), Blue (Manager), Green (Worker)
- Toggle between graph and list views

### ✅ Approval Workflows

- Pending change queue with risk-level badges
- Inline diff viewer for file changes
- Batch approve low-risk changes
- Auto-polling for new approvals

### 📋 Sidebar Tree Views

- Agents — Browse the 3-tier hierarchy
- Tasks — Active and completed task list
- Contexts — Namespace management
- Knowledge — Indexed memory entries

### ⚡ Performance

- **Preact 10** — 3KB React-compatible UI (not 42KB React)
- **Total bundle: ~100KB** — Fast webview loading
- Zustand state management — Minimal re-renders
- Typed RPC with correlation IDs — Reliable extension↔webview communication

## 🚀 Getting Started

1. Install the extension
2. Ensure AETHER MCP server is running (`bun run bin/aether-mcp.ts`)
3. Press `Ctrl+Shift+A` (or `Cmd+Shift+A` on Mac) to open the dashboard
4. Or use the Command Palette: `AETHER: Open Dashboard`

## ⌨️ Commands

| Command                         | Shortcut       | Description                    |
| ------------------------------- | -------------- | ------------------------------ |
| `AETHER: Open Dashboard`        | `Ctrl+Shift+A` | Open the unified dashboard     |
| `AETHER: Dashboard — Overview`  |                | Jump to Overview tab           |
| `AETHER: Dashboard — Agents`    |                | Jump to Agents tab             |
| `AETHER: Dashboard — Tasks`     |                | Jump to Tasks tab              |
| `AETHER: Dashboard — Chat`      |                | Jump to Chat tab               |
| `AETHER: Dashboard — Approvals` |                | Jump to Approvals tab          |
| `AETHER: Dashboard — Memory`    |                | Jump to Memory tab             |
| `AETHER: Dashboard — Settings`  |                | Jump to Settings tab           |
| `AETHER: Run Task`              |                | Submit a new task              |
| `AETHER: Plan Task`             |                | Decompose a task into subtasks |

## ⚙️ Configuration

| Setting                      | Default     | Description                                    |
| ---------------------------- | ----------- | ---------------------------------------------- |
| `aether.runtimePath`         | Auto-detect | Path to AETHER installation                    |
| `aether.autoApprove`         | `none`      | Auto-approve changes: `none`, `workers`, `all` |
| `aether.budgetLimit`         | `0`         | Max spend per session in USD (0 = unlimited)   |
| `aether.showCostInStatusBar` | `true`      | Show running cost in status bar                |
| `aether.defaultContext`      | `default`   | Default agent namespace                        |

## 🏗️ Architecture

```
Extension Host (Node.js)          Webview (Browser)
┌──────────────────────┐          ┌──────────────────────┐
│  DashboardPanelMgr   │◄──RPC──►│  Preact Dashboard    │
│  AetherBridge        │          │  Zustand Stores      │
│  Chat Participant    │          │  Tailwind CSS        │
│  TreeView Providers  │          │  markdown-it + Prism │
└──────────────────────┘          └──────────────────────┘
         │
         ▼
   AETHER MCP Server
   (34 agent hierarchy)
```

## 📦 Requirements

- VS Code 1.93.0+
- AETHER framework installed (`npm i @ahmedtaha/aether`)
- Node.js 20+

## 📄 License

MIT — See [LICENSE](LICENSE) for details.
