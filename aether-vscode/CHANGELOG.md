# Change Log

## [0.1.0] — 2025-03-08

### Added

- **Unified Dashboard** — Single tabbed webview panel replacing 4 separate panels
  - Overview tab: Health cards, system info, cost sparklines, quick actions
  - Agents tab: Interactive SVG hierarchy graph + list view with search/filter
  - Tasks tab: Task tree, submission modal, cancel/retry, progress tracking
  - Chat tab: Full markdown rendering (markdown-it + Prism.js), slash commands, code block "Apply"
  - Approvals tab: Pending queue, inline diff viewer, batch approve/reject
  - Memory tab: RAG search with type filters
  - Settings tab: Dynamic form editor with save/reset and feedback indicators

- **Agent Hierarchy Visualization** — Custom interactive SVG graph
  - 3-tier layout: Master → Managers → Workers
  - Animated flow particles on selected connections
  - Zoom, pan, click-to-select
  - Busy pulse indicators, status rings
  - Toggle between graph and list views

- **Component Library** — 12 themed UI components
  - Button, Badge, Card, Input, Textarea, Select, Tabs, Modal, Progress, Spinner, EmptyState, Tooltip
  - All mapped to VS Code CSS custom properties

- **Typed RPC Message Bus** — Extension↔Webview communication
  - Correlation IDs for request/response matching
  - 30-second timeout with error handling
  - Event subscription system

- **State Management** — 5 Zustand stores
  - Dashboard UI, System health, Agents, Tasks, Chat

- **Build System** — esbuild with Preact + Tailwind
  - Dual-bundle: extension.js + webview.js
  - PostCSS/Tailwind processing inline
  - ~100KB total bundle size

### Technical

- Preact 10 with preact/compat (3KB vs React's 42KB)
- Tailwind CSS with VS Code CSS variable mapping
- markdown-it + Prism.js for chat rendering
- WebviewPanelSerializer for state persistence
- Content Security Policy with nonce-based scripts
