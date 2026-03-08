# AETHER VS Code Extension Dashboard — Specification

## 1. Project Overview

### 1.1 What We're Building

A modern, feature-rich dashboard for the AETHER VS Code extension that replaces the current vanilla DOM webview with a Preact-based interface. The dashboard consolidates agent orchestration, task management, approval workflows, memory exploration, and settings into a unified tabbed interface.

### 1.2 Why This Matters

- **Developer Productivity**: Single pane of glass for multi-agent AI orchestration
- **User Experience**: Modern React-like development with VS Code integration
- **Performance**: 180-210KB bundle vs current heavy vanilla implementation
- **Maintainability**: Component-based architecture with TypeScript safety
- **Extensibility**: Foundation for advanced features like visual agent flows

### 1.3 Target Users

- **Primary**: Software developers using AETHER for AI-assisted development
- **Secondary**: Team leads monitoring agent usage and performance
- **Tertiary**: DevOps engineers configuring multi-agent workflows

## 2. User Stories & Acceptance Criteria

### 2.1 Epic: Dashboard Foundation (P1)

**US-001: Developer opens unified dashboard**
As a developer, I want to access all AETHER features from a single dashboard so I can orchestrate agents efficiently.

_Acceptance Criteria:_

- GIVEN I'm in VS Code with AETHER installed
- WHEN I press Ctrl+Shift+A or use Command Palette "AETHER: Open Dashboard"
- THEN a unified dashboard opens with 7 tabs: Overview, Agents, Tasks, Chat, Approvals, Memory, Settings
- AND the dashboard persists state when VS Code restarts
- AND switching between tabs is instant (<100ms)

**US-002: Developer sees system health at a glance**
As a developer, I want to see AETHER system status immediately so I can identify issues quickly.

_Acceptance Criteria:_

- GIVEN the dashboard is open on the Overview tab
- WHEN the system loads
- THEN I see health cards showing: Agent Status (33/34 online), Active Tasks (12), Memory Usage (2.3GB), Cost Today ($4.50)
- AND warning states are visually distinct (yellow/red indicators)
- AND clicking a health card navigates to the relevant detailed tab

### 2.2 Epic: Agent Management (P1)

**US-003: Developer visualizes agent hierarchy**
As a developer, I want to see the 3-tier agent hierarchy visually so I can understand the orchestration structure.

_Acceptance Criteria:_

- GIVEN I'm on the Agents tab
- WHEN the view loads
- THEN I see a React Flow diagram with 1 Master, 8 Manager, 25 Worker agents
- AND nodes are color-coded by tier and status (online/offline/busy)
- AND I can zoom, pan, and auto-layout the hierarchy
- AND clicking an agent node shows details in a side panel

**US-004: Developer searches and filters agents**
As a developer, I want to filter agents by capability so I can find the right agent for my task.

_Acceptance Criteria:_

- GIVEN I'm viewing the agent hierarchy
- WHEN I use the search box or capability filters
- THEN only matching agents are highlighted/shown
- AND I can filter by: status, tier, capability tags, recent activity
- AND search is real-time (no submit button needed)

### 2.3 Epic: Task Management (P1)

**US-005: Developer submits tasks through dashboard**
As a developer, I want to submit tasks via a rich form so I can leverage advanced task configuration.

_Acceptance Criteria:_

- GIVEN I'm on the Tasks tab
- WHEN I click "New Task"
- THEN I see a form with: Task Description, Target Agent (dropdown), Priority (P1/P2/P3), Context Files (file picker)
- AND form validation prevents invalid submissions
- AND I can save as draft or submit immediately

**US-006: Developer monitors active tasks**
As a developer, I want to see all active tasks and their progress so I can track my work.

_Acceptance Criteria:_

- GIVEN I have submitted tasks (minimum 5 tasks in different states)
- WHEN I view the Tasks tab
- THEN I see a list/tree of active tasks with: status, progress % (0-100), estimated completion time, assigned agent name
- AND I can expand tasks to see subtasks (indented by 20px per level)
- AND I can cancel running tasks (confirmation dialog required) or retry failed tasks (single click)
- AND real-time updates reflect task status changes within 2 seconds of actual change

### 2.4 Epic: Rich Chat Interface (P1)

**US-007: Developer uses enhanced chat**
As a developer, I want a rich chat interface that supplements the Chat Participant so I can have better conversations with agents.

_Acceptance Criteria:_

- GIVEN I'm on the Chat tab
- WHEN I interact with agents
- THEN I see properly rendered markdown (headers, lists, tables), syntax-highlighted code blocks (20+ languages), and interactive "Apply" buttons (green, right-aligned)
- AND I can use all 9 slash commands: /run, /plan, /review, /test, /debug, /architect, /group, /status, /context
- AND code suggestions have one-click apply functionality (saves file automatically, shows success notification)
- AND conversation history is searchable (full-text search, loads results <200ms, shows 10 results per page)

### 2.5 Epic: Approval Workflows (P2)

**US-008: Developer manages code approvals**
As a developer, I want to review and approve agent-generated code changes so I maintain control over my codebase.

_Acceptance Criteria:_

- GIVEN agents have generated code changes (minimum 3 pending approvals)
- WHEN I open the Approvals tab
- THEN I see pending changes with diff previews (side-by-side, syntax highlighted, line numbers)
- AND I can approve (green checkmark), reject (red X), or request modifications (orange edit icon)
- AND I can batch approve similar changes (checkbox selection, "Approve All" button for 2+ items)
- AND I can set auto-approve rules for trusted operations (pattern matching, agent whitelist, file type filters)

### 2.6 Epic: Memory & Knowledge (P2)

**US-009: Developer searches agent memory**
As a developer, I want to search AETHER's memory and knowledge base so I can understand what the system knows about my project.

_Acceptance Criteria:_

- GIVEN AETHER has accumulated project knowledge (minimum 100 memory entries)
- WHEN I use the Memory tab search
- THEN I find relevant results in 4 categories: conversation history, code embeddings, learned patterns, cached results
- AND search supports: semantic search (vector similarity), date filters (last 7/30/90 days), agent filters (dropdown), context filters (file type)
- AND results show relevance scores (0.0-1.0, 2 decimal places) and source references (clickable links to original context)

### 2.7 Epic: Configuration Management (P3)

**US-010: Developer configures system settings**
As a developer, I want to configure AETHER settings through a rich UI so I can customize behavior without editing JSON.

_Acceptance Criteria:_

- GIVEN I need to modify AETHER configuration
- WHEN I use the Settings tab
- THEN I see organized sections: Providers (API keys), Agent Config, Performance, Security
- AND form controls are typed and validated
- AND changes preview their effect before saving
- AND I can export/import configurations

## 3. Technical Architecture

### 3.1 Component Diagram

```
Extension Host (Node.js)
├── extension.ts (VS Code API)
├── aether-bridge.ts (MCP Client)
└── DashboardPanel (WebviewPanel)
    └── postMessage ↔ Webview Context
                        │
Webview Context (Preact)
├── App.tsx (Root Component)
├── TabManager (Client-side Routing)
├── MessageBus (RPC over postMessage)
├── StateManager (Zustand)
└── 7 Tab Components
    ├── OverviewTab
    ├── AgentsTab (React Flow)
    ├── TasksTab
    ├── ChatTab (markdown-it + Prism)
    ├── ApprovalsTab
    ├── MemoryTab
    └── SettingsTab
```

### 3.2 Data Flow

1. **Extension Host → Webview**: System state, MCP responses, VS Code events
2. **Webview → Extension Host**: User actions, MCP requests, configuration changes
3. **MCP Bridge**: JSON-RPC over stdio to `bin/aether-mcp.ts`
4. **State Management**: Zustand stores in webview, synchronized with extension host
5. **Real-time Updates**: WebSocket events from AETHER core → extension → webview

### 3.3 State Management Architecture

The webview uses Zustand for lightweight, reactive state management with four primary stores:

```typescript
// Dashboard store - UI state and navigation
interface DashboardStore {
  // Current tab state
  activeTab: string;
  tabHistory: string[];
  
  // UI state
  sidebarOpen: boolean;
  theme: "light" | "dark" | "auto";
  
  // Actions
  setActiveTab: (tab: string) => void;
  toggleSidebar: () => void;
  setTheme: (theme: "light" | "dark" | "auto") => void;
}

// System store - health and status data
interface SystemStore {
  // System status (from GetSystemStatusParams)
  status: SystemStatus | null;
  loading: boolean;
  error: string | null;
  
  // Real-time connection
  connected: boolean;
  lastUpdate: string;
  
  // Actions
  updateStatus: (status: SystemStatus) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
}

// Agents store - agent hierarchy and state
interface AgentsStore {
  // Agent data
  agents: Record<string, Agent>;
  hierarchy: { master: string; managers: string[]; workers: string[] };
  
  // Filters and search
  searchTerm: string;
  filters: {
    status?: Agent["status"][];
    tier?: Agent["tier"][];
    capabilities?: string[];
  };
  
  // Selected state
  selectedAgent: string | null;
  
  // Actions
  setAgents: (agents: Agent[]) => void;
  updateAgent: (agentId: string, updates: Partial<Agent>) => void;
  setSearch: (term: string) => void;
  setFilters: (filters: AgentsStore["filters"]) => void;
  selectAgent: (agentId: string | null) => void;
}

// Tasks store - task management
interface TasksStore {
  // Task data
  tasks: Record<string, Task>;
  taskHierarchy: Record<string, string[]>; // parentId -> childIds
  
  // UI state
  expandedTasks: Set<string>;
  selectedTask: string | null;
  
  // Form state
  taskForm: {
    description: string;
    targetAgent?: string;
    priority: "P1" | "P2" | "P3";
    contextFiles: string[];
    metadata: Record<string, any>;
  };
  
  // Actions
  setTasks: (tasks: Task[]) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  toggleTaskExpanded: (taskId: string) => void;
  selectTask: (taskId: string | null) => void;
  updateTaskForm: (updates: Partial<TasksStore["taskForm"]>) => void;
}

// Chat store - conversation state
interface ChatStore {
  // Messages
  messages: ChatMessage[];
  conversationId?: string;
  
  // Input state
  inputValue: string;
  selectedCommand?: string;
  contextFiles: string[];
  
  // UI state
  loading: boolean;
  error: string | null;
  
  // Actions
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  setInput: (value: string) => void;
  setCommand: (command: string | undefined) => void;
  setContextFiles: (files: string[]) => void;
  setLoading: (loading: boolean) => void;
}

// Store synchronization
interface StoreSyncManager {
  // Sync state between extension and webview
  syncFromExtension: (data: any) => void;
  syncToExtension: (storeName: string, data: any) => void;
  
  // Request full state refresh
  requestFullSync: () => void;
  
  // Handle real-time events
  handleEvent: (event: ExtensionEvent) => void;
}
```

**State Synchronization Protocol**:
1. **Initial Load**: Webview requests full state via `getSystemStatus`, `getAgents`, etc.
2. **Real-time Updates**: Extension pushes events (`agent_status_changed`, `task_updated`) to update stores
3. **User Actions**: Webview sends RPC requests, then optimistically updates local state
4. **Error Handling**: Failed actions revert optimistic updates and show error state

### 3.4 Technology Stack

- **Frontend Framework**: Preact 10 + preact/compat (3KB)
- **Styling**: Tailwind CSS + VS Code CSS variables (~10KB purged)
- **State Management**: Zustand (lightweight Redux alternative)
- **Visualization**: React Flow (@xyflow/react) for agent hierarchy
- **Markdown**: markdown-it with Prism.js syntax highlighting
- **Build System**: esbuild (existing config extended)
- **Bundle Target**: ~180-210KB total

## 4. API Contract

### 4.1 Message Protocol

All messages between Extension Host ↔ Webview use typed RPC with correlation IDs:

```typescript
// Base message structure
interface BaseMessage {
  id: string; // correlation ID
  type: string;
  timestamp: number;
}

// Request from webview to extension
interface WebviewRequest extends BaseMessage {
  type: "request";
  method: string;
  params?: any;
}

// Response from extension to webview
interface ExtensionResponse extends BaseMessage {
  type: "response";
  correlationId: string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// Event from extension to webview (base interface)
interface ExtensionEventMessage extends BaseMessage {
  type: "event";
  event: string;
  data?: any;
}
```

### 4.2 RPC Methods

```typescript
// System status and health
interface GetSystemStatusParams {}
interface SystemStatus {
  agents: {
    total: number;
    online: number;
    busy: number;
    offline: number;
  };
  tasks: {
    active: number;
    queued: number;
    completed: number;
    failed: number;
  };
  memory: {
    used: number; // bytes
    available: number;
    cacheHits: number;
    cacheMisses: number;
  };
  cost: {
    today: number; // USD
    thisMonth: number;
    lastMonth: number;
  };
  uptime: number; // seconds
  version: string;
}

// Agent management
interface GetAgentsParams {
  includeOffline?: boolean;
  tier?: "master" | "manager" | "worker";
  capabilities?: string[];
}

interface Agent {
  id: string;
  name: string;
  tier: "master" | "manager" | "worker";
  status: "online" | "offline" | "busy" | "error";
  capabilities: string[];
  currentTask?: string;
  completedTasks: number;
  avgResponseTime: number; // ms
  lastSeen: string; // ISO timestamp
  parent?: string; // parent agent ID
  children: string[]; // child agent IDs
}

// Task management
interface SubmitTaskParams {
  description: string;
  targetAgent?: string;
  priority: "P1" | "P2" | "P3";
  contextFiles?: string[];
  metadata?: Record<string, any>;
}

interface Task {
  id: string;
  description: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number; // 0-100
  assignedAgent: string;
  parentTask?: string;
  subtasks: string[];
  created: string; // ISO timestamp
  started?: string;
  completed?: string;
  result?: any;
  error?: string;
  estimatedCompletion?: string;
  actualDuration?: number; // seconds
}

// Chat and conversation
interface SendChatMessageParams {
  message: string;
  command?: string; // slash command
  context?: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  agent?: string;
  command?: string;
  codeBlocks?: CodeBlock[];
  attachments?: Attachment[];
}

interface CodeBlock {
  id: string;
  language: string;
  code: string;
  filename?: string;
  applied: boolean;
}

// File attachments for chat messages
interface Attachment {
  id: string;
  type: "file" | "code" | "image" | "link";
  name: string;
  content?: string;
  url?: string;
  size?: number;
  mimeType?: string;
}

// Approval workflow
interface GetPendingApprovalsParams {}

interface Approval {
  id: string;
  type: "code_change" | "file_creation" | "file_deletion" | "command_execution";
  description: string;
  agent: string;
  task: string;
  created: string;
  changes: FileChange[];
  riskLevel: "low" | "medium" | "high";
  autoApprovable: boolean;
}

interface FileChange {
  path: string;
  type: "create" | "modify" | "delete";
  oldContent?: string;
  newContent?: string;
  diff?: string;
}

// Memory and knowledge
interface SearchMemoryParams {
  query: string;
  type?: "conversation" | "code" | "embedding" | "cache";
  agent?: string;
  dateRange?: [string, string];
  limit?: number;
}

interface MemoryResult {
  id: string;
  type: "conversation" | "code" | "embedding" | "cache";
  content: string;
  score: number; // relevance 0-1
  source: string;
  timestamp: string;
  agent?: string;
  context?: Record<string, any>;
}

// Task operations
interface CancelTaskParams {
  taskId: string;
  reason?: string;
}

interface RetryTaskParams {
  taskId: string;
  resetProgress?: boolean;
}

// Approval operations
interface ApproveChangeParams {
  approvalId: string;
  comment?: string;
}

interface RejectChangeParams {
  approvalId: string;
  reason: string;
}

interface BatchApproveParams {
  approvalIds: string[];
  comment?: string;
}

interface RequestModificationsParams {
  approvalId: string;
  modifications: string;
}

interface SetAutoApproveRulesParams {
  rules: AutoApprovalRule[];
}

// Code operations
interface ApplyCodeBlockParams {
  blockId: string;
  filename?: string;
}

// Chat operations
interface GetConversationHistoryParams {
  limit?: number;
  before?: string; // message ID
  agent?: string;
}

// Draft operations
interface SaveDraftParams {
  content: string;
  type: "task" | "chat" | "config";
  metadata?: Record<string, any>;
}

interface GetDraftsParams {
  type?: "task" | "chat" | "config";
}

interface Draft {
  id: string;
  type: "task" | "chat" | "config";
  content: string;
  metadata?: Record<string, any>;
  created: string;
  updated: string;
}

// Configuration
interface GetConfigParams {}
interface UpdateConfigParams {
  section: string;
  updates: Record<string, any>;
}

interface Config {
  providers: {
    openai?: {
      apiKey: string;
      baseURL?: string;
      models: string[];
    };
    anthropic?: {
      apiKey: string;
      models: string[];
    };
    // ... other providers
  };
  agents: {
    maxConcurrent: number;
    timeout: number;
    retries: number;
    costLimits: {
      daily: number;
      monthly: number;
    };
  };
  performance: {
    cacheSize: number;
    logLevel: string;
    enableTelemetry: boolean;
  };
  security: {
    autoApprove: {
      enabled: boolean;
      rules: AutoApprovalRule[];
    };
    codeExecution: {
      enabled: boolean;
      allowedCommands: string[];
    };
  };
}

// Auto-approval rules for security
interface AutoApprovalRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    filePatterns?: string[]; // glob patterns
    agents?: string[]; // allowed agent IDs
    changeTypes?: ("create" | "modify" | "delete")[];
    maxLinesChanged?: number;
    requiresReview?: boolean;
  };
  actions: {
    autoApprove: boolean;
    notifyUser?: boolean;
    logLevel?: "info" | "warning" | "error";
  };
  created: string;
  lastModified: string;
}
```

### 4.3 Event Types

```typescript
// Real-time events from extension to webview
type ExtensionEvent =
  | {
      event: "agent_status_changed";
      data: { agentId: string; status: Agent["status"] };
    }
  | { event: "task_updated"; data: { taskId: string; updates: Partial<Task> } }
  | { event: "task_created"; data: Task }
  | { event: "chat_message"; data: ChatMessage }
  | { event: "approval_created"; data: Approval }
  | {
      event: "approval_resolved";
      data: { approvalId: string; decision: "approved" | "rejected" };
    }
  | {
      event: "system_alert";
      data: { level: "info" | "warning" | "error"; message: string };
    }
  | {
      event: "config_changed";
      data: { section: string; changes: Record<string, any> };
    };
```

## 5. Component Specifications

### 5.1 Core Component Library

```typescript
// Base component props
interface BaseProps {
  className?: string;
  children?: ComponentChildren;
}

// Button component
interface ButtonProps extends BaseProps {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}

// Input component
interface InputProps extends BaseProps {
  type?: "text" | "email" | "password" | "number";
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

// Card component
interface CardProps extends BaseProps {
  title?: string;
  subtitle?: string;
  actions?: ComponentChildren;
}

// Table component
interface TableProps<T> extends BaseProps {
  data: T[];
  columns: TableColumn<T>[];
  loading?: boolean;
  emptyState?: ComponentChildren;
  onRowClick?: (item: T) => void;
}

interface TableColumn<T> {
  key: keyof T;
  header: string;
  render?: (value: T[keyof T], item: T) => ComponentChildren;
  sortable?: boolean;
  width?: string;
}

// Modal component
interface ModalProps extends BaseProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

// Badge component
interface BadgeProps extends BaseProps {
  variant?: "default" | "success" | "warning" | "error" | "info";
  size?: "sm" | "md";
}

// Progress component
interface ProgressProps extends BaseProps {
  value: number; // 0-100
  showLabel?: boolean;
  color?: string;
}

// Code block component
interface CodeBlockProps extends BaseProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  onApply?: () => void;
  applied?: boolean;
}
```

### 5.2 Specialized Components

```typescript
// Agent node for React Flow
interface AgentNodeProps {
  data: Agent;
  selected: boolean;
}

// Health card for overview
interface HealthCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  status: "healthy" | "warning" | "error";
  trend?: "up" | "down" | "stable";
  onClick?: () => void;
}

// Task item component
interface TaskItemProps {
  task: Task;
  level?: number; // for nesting subtasks
  onCancel?: () => void;
  onRetry?: () => void;
  onExpand?: () => void;
}

// Diff viewer for approvals
interface DiffViewerProps {
  oldContent?: string;
  newContent?: string;
  filename?: string;
  language?: string;
}

// Search with filters
interface SearchWithFiltersProps {
  value: string;
  onChange: (value: string) => void;
  filters: Filter[];
  activeFilters: Record<string, any>;
  onFilterChange: (filters: Record<string, any>) => void;
}

interface Filter {
  key: string;
  label: string;
  type: "select" | "multiselect" | "daterange" | "checkbox";
  options?: { label: string; value: any }[];
}

// Missing core UI components used in views
interface TabsProps extends BaseProps {
  value: string;
  onChange: (value: string) => void;
  children: ComponentChildren;
}

interface TabProps extends BaseProps {
  value: string;
  label: string;
  icon?: ComponentChildren;
  badge?: number;
  disabled?: boolean;
}

interface TimelineProps extends BaseProps {
  items: TimelineItem[];
  compact?: boolean;
}

interface TimelineItem {
  id: string;
  timestamp: string;
  title: string;
  description?: string;
  icon?: ComponentChildren;
  type?: "success" | "error" | "info" | "warning";
}

interface ActivityHeatmapProps extends BaseProps {
  data: ActivityData[];
  startDate: string;
  endDate: string;
  onClick?: (date: string, value: number) => void;
}

interface ActivityData {
  date: string; // YYYY-MM-DD
  value: number;
  tooltip?: string;
}

interface SelectProps extends BaseProps {
  value?: any;
  onChange: (value: any) => void;
  placeholder?: string;
  options: SelectOption[];
  disabled?: boolean;
  error?: string;
  multiple?: boolean;
}

interface SelectOption {
  label: string;
  value: any;
  disabled?: boolean;
  icon?: ComponentChildren;
}

interface CheckboxProps extends BaseProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  error?: string;
  indeterminate?: boolean;
}

interface TextareaProps extends BaseProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  error?: string;
  resize?: boolean;
}

interface FileSelectProps extends BaseProps {
  value?: string[];
  onChange: (files: string[]) => void;
  multiple?: boolean;
  accept?: string; // file extension filter
  placeholder?: string;
  error?: string;
}

interface FormSectionProps extends BaseProps {
  title: string;
  description?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

interface PanelProps extends BaseProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  width?: string;
  title?: string;
}

interface ChatMessageComponentProps extends BaseProps {
  message: ChatMessage;
  onApplyCode?: (blockId: string) => void;
  onRetry?: () => void;
  compact?: boolean;
}
```

## 6. View Specifications

### 6.1 Overview Tab

**Purpose**: System health dashboard and quick actions

**Layout**:

```
┌─────────────────────────────────────┐
│ Health Cards (4x grid)              │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │
│ │Agent│ │Tasks│ │ Mem │ │Cost │    │
│ │33/34│ │ 12  │ │2.3GB│ │$4.50│    │
│ └─────┘ └─────┘ └─────┘ └─────┘    │
├─────────────────────────────────────┤
│ Quick Actions                        │
│ [New Task] [Open Chat] [Settings]   │
├─────────────────────────────────────┤
│ Recent Activity Timeline             │
│ • Task completed: "Fix bug in auth" │
│ • Agent came online: "code-reviewer"│
│ • Approval needed: "Update config"  │
├─────────────────────────────────────┤
│ Activity Heatmap (7-day)            │
│ Mon ████ Tue ████ Wed ████ ...      │
└─────────────────────────────────────┘
```

**Components Used**: HealthCard, Button, Timeline, ActivityHeatmap

### 6.2 Agents Tab

**Purpose**: Visual agent hierarchy and management

**Layout**:

```
┌─────────────────────────────────────┐
│ Search & Filters                    │
│ [Search agents...] [Status▼] [Tier▼]│
├─────────────────────────────────────┤
│ React Flow Diagram                  │
│                                     │
│     ┌─────────────┐                │
│     │   Master    │                │
│     └─────┬───────┘                │
│           │                         │
│    ┌──────┴──────┐                 │
│    │  Managers   │                 │
│    └──────┬──────┘                 │
│           │                         │
│    ┌──────┴──────┐                 │
│    │   Workers   │                 │
│    └─────────────┘                 │
├─────────────────────────────────────┤
│ Agent Details Panel (slide-out)     │
│ Name: code-reviewer                 │
│ Status: ● Online                    │
│ Tasks: 3 completed, 1 active       │
│ Avg Response: 2.3s                 │
└─────────────────────────────────────┘
```

**Components Used**: SearchWithFilters, ReactFlow, AgentNode, Panel

### 6.3 Tasks Tab

**Purpose**: Task management and monitoring

**Layout**:

```
┌─────────────────────────────────────┐
│ [New Task] [Refresh] Filters: [All▼]│
├─────────────────────────────────────┤
│ Active Tasks Tree                    │
│ ┌─ 🔄 Fix authentication bug       │
│ │   ├─ 🔄 Analyze auth flow        │
│ │   ├─ ✅ Review security model    │
│ │   └─ ⏳ Implement fixes          │
│ ├─ ⏳ Update documentation         │
│ └─ ✅ Refactor user service        │
├─────────────────────────────────────┤
│ Task Submission Form (modal)        │
│ Description: [large text area]      │
│ Target Agent: [dropdown]            │
│ Priority: [P1] [P2] [P3]           │
│ Context Files: [file picker]        │
│ [Save Draft] [Submit]               │
└─────────────────────────────────────┘
```

**Components Used**: Button, TaskItem, Modal, Input, Select, FileSelect

### 6.4 Chat Tab

**Purpose**: Rich chat interface with agent interaction

**Layout**:

````
┌─────────────────────────────────────┐
│ Chat History                        │
│ You: Can you review my auth code?   │
│                                     │
│ 🤖 code-reviewer:                   │
│ I found 2 security issues:          │
│ ```typescript                       │
│ // Vulnerable code here             │
│ ```                                 │
│ [Apply Fix] [Explain More]          │
├─────────────────────────────────────┤
│ Message Input                       │
│ [Type message...] [/commands ▼] [⏎] │
│ /run /plan /review /test /debug     │
└─────────────────────────────────────┘
````

**Components Used**: ChatMessage, CodeBlock, Button, Input, Dropdown

### 6.5 Approvals Tab

**Purpose**: Code review and approval workflow

**Layout**:

```
┌─────────────────────────────────────┐
│ Pending Approvals (3)               │
│ [Auto-Approve Similar] [Batch Ops▼] │
├─────────────────────────────────────┤
│ ⚠️ HIGH RISK: Database migration     │
│ Agent: db-expert | Task: Update DB  │
│ ┌─ src/migrations/001_users.sql    │
│ │ + CREATE TABLE users (            │
│ │ +   id UUID PRIMARY KEY,          │
│ │ +   email VARCHAR(255) UNIQUE     │
│ │ + );                              │
│ └─────────────────────────────────  │
│ [Approve] [Reject] [Request Changes]│
├─────────────────────────────────────┤
│ ✅ LOW RISK: Fix typo in comments   │
│ [Approve] [View Details]            │
└─────────────────────────────────────┘
```

**Components Used**: Badge, DiffViewer, Button, Card

### 6.6 Memory Tab

**Purpose**: Search and explore AETHER's knowledge

**Layout**:

```
┌─────────────────────────────────────┐
│ Search Memory                       │
│ [Search...] [Type▼] [Agent▼] [Date▼]│
├─────────────────────────────────────┤
│ Results (23 found)                  │
│ ┌─ 🧠 Code Pattern Recognition      │
│ │ Learned: React component patterns │
│ │ Score: 0.95 | Source: Chat       │
│ │ Agent: react-expert               │
│ ├─ 💬 Conversation: "Auth bug fix" │
│ │ User discussed JWT validation...   │
│ │ Score: 0.87 | 2 days ago         │
│ └─ 📝 Code Embedding: auth.ts      │
│   Function validateToken() analysis │
│   Score: 0.82 | File: src/auth.ts  │
├─────────────────────────────────────┤
│ Knowledge Graph (preview)           │
│ [Entities] [Relationships] [Export] │
└─────────────────────────────────────┘
```

**Components Used**: SearchWithFilters, Card, Badge, Button

### 6.7 Settings Tab

**Purpose**: Configuration management

**Layout**:

```
┌─────────────────────────────────────┐
│ Configuration Sections              │
│ ┌─ 🔑 Providers                    │
│ │ OpenAI API Key: [••••••••••]     │
│ │ Anthropic API Key: [••••••••••]  │
│ │ [Test Connection]                 │
│ ├─ 🤖 Agent Settings               │
│ │ Max Concurrent: [5] agents       │
│ │ Timeout: [30] seconds            │
│ │ Daily Cost Limit: [$50.00]      │
│ ├─ ⚡ Performance                  │
│ │ Cache Size: [1GB]                │
│ │ Log Level: [Info ▼]             │
│ │ ☑️ Enable Telemetry              │
│ └─ 🔒 Security                     │
│   ☑️ Auto-approve low-risk changes │
│   ☑️ Enable code execution         │
│   Allowed Commands: [edit list]    │
│                                     │
│ [Save] [Reset] [Export] [Import]    │
└─────────────────────────────────────┘
```

**Components Used**: Input, Select, Checkbox, Button, Card, FormSection

## 7. Extension Host Changes

### 7.1 New Commands

```typescript
// Add to package.json commands
{
  "command": "aether.dashboard",
  "title": "Open Dashboard",
  "category": "AETHER"
},
{
  "command": "aether.dashboard.overview",
  "title": "Dashboard: Overview",
  "category": "AETHER"
},
// ... one for each tab

// Add keybinding
{
  "command": "aether.dashboard",
  "key": "ctrl+shift+a",
  "mac": "cmd+shift+a"
}
```

### 7.2 Extension.ts Changes

```typescript
import { DashboardPanelManager } from "./panels/dashboard-panel-manager";

export function activate(context: vscode.ExtensionContext) {
  // ... existing code

  // Dashboard panel manager
  const dashboardManager = new DashboardPanelManager(context, bridge);

  // Register dashboard commands
  context.subscriptions.push(
    vscode.commands.registerCommand("aether.dashboard", () => {
      dashboardManager.show();
    }),
    vscode.commands.registerCommand("aether.dashboard.overview", () => {
      dashboardManager.show("overview");
    }),
    // ... other tab commands
  );

  // Register serializer for persistence
  vscode.window.registerWebviewPanelSerializer("aether.dashboard", {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
      dashboardManager.restore(panel, state);
    },
  });
}
```

### 7.3 Dashboard Panel Manager

```typescript
// src/panels/dashboard-panel-manager.ts
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

    this.setupWebview(initialTab);
  }

  private setupWebview(initialTab?: string): void {
    if (!this.panel) return;

    // Set HTML content
    this.panel.webview.html = this.getWebviewContent();

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      this.handleWebviewMessage.bind(this),
      undefined,
      this.disposables,
    );

    // Clean up on dispose
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    });

    // Send initial state
    if (initialTab) {
      // Use a disposable listener for the ready message to avoid leaks
      const readyListener = this.panel.webview.onDidReceiveMessage((message) => {
        if (message.type === "ready") {
          this.postMessage({ type: "navigate", tab: initialTab });
          // Clean up this listener after handling ready message
          readyListener.dispose();
        }
      });
      this.disposables.push(readyListener);
    }
  }

  private async handleWebviewMessage(message: WebviewRequest): Promise<void> {
    try {
      const result = await this.executeRPCMethod(
        message.method,
        message.params,
      );
      this.postMessage({
        type: "response",
        id: message.id,
        correlationId: message.id,
        result,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.postMessage({
        type: "response",
        id: message.id,
        correlationId: message.id,
        error: {
          code: -1,
          message: error.message || "Unknown error",
        },
        timestamp: Date.now(),
      });
    }
  }

  private async executeRPCMethod(method: string, params?: any): Promise<any> {
    switch (method) {
      case "getSystemStatus":
        return this.getSystemStatus();
      case "getAgents":
        return this.getAgents(params);
      case "submitTask":
        return this.submitTask(params);
      case "sendChatMessage":
        return this.sendChatMessage(params);
      // ... implement all RPC methods
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  // Implement all RPC methods using the bridge
  private async getSystemStatus(): Promise<SystemStatus> {
    // Call bridge.call() to get status from MCP server
    // Transform and return as SystemStatus
  }

  // ... other methods
}
```

## 8. Build System Changes

### 8.1 Dependencies

```json
// package.json additions
{
  "dependencies": {
    "preact": "^10.19.3",
    "@preact/compat": "^17.1.2",
    "@xyflow/react": "^11.10.1",
    "zustand": "^4.4.7",
    "markdown-it": "^14.0.0",
    "prismjs": "^1.29.0",
    "clsx": "^2.0.0",
    "isomorphic-dompurify": "^2.8.0"
  },
  "devDependencies": {
    "@types/markdown-it": "^13.0.7",
    "@types/prismjs": "^1.26.3",
    "@types/dompurify": "^3.0.5",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32"
  }
}
```

### 8.2 esbuild Configuration

**Note**: The following configuration aligns with the existing `esbuild.config.mjs` to avoid breaking changes. Key alignments:
- Webview format remains `esm` (not `iife`) to match existing config
- Webview target remains `es2022` (not `es2020`) to match existing config  
- Extension target remains `node20` (not `node16`) to match existing config
- Entry point remains `src/webview-ui/App.tsx` (existing file, not `index.tsx`)
- Minify condition uses `!isWatch` pattern to match existing config

```javascript
// esbuild.config.mjs updates
import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

// Extension host bundle (existing - no changes needed)
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20", // Keep existing target
  sourcemap: true,
  minify: !isWatch, // Keep existing pattern
};

// Webview bundle (enhanced existing config)
const webviewConfig = {
  entryPoints: ["src/webview-ui/App.tsx"], // Keep existing entry point
  bundle: true,
  outfile: "dist/webview.js",
  format: "esm", // Keep existing format
  platform: "browser",
  target: "es2022", // Keep existing target
  sourcemap: true,
  minify: !isWatch, // Keep existing pattern
  define: {
    "process.env.NODE_ENV": isWatch ? '"development"' : '"production"',
  },
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
  },
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
    ".css": "css",
  },
  plugins: [
    // PostCSS plugin for Tailwind processing
    {
      name: 'postcss',
      setup(build) {
        build.onLoad({ filter: /\.css$/ }, async (args) => {
          const postcss = await import('postcss');
          const tailwind = await import('tailwindcss');
          const autoprefixer = await import('autoprefixer');
          
          const result = await postcss.default([
            tailwind.default,
            autoprefixer.default,
          ]).process(await require('fs').promises.readFile(args.path, 'utf8'), {
            from: args.path,
          });
          
          return { contents: result.css, loader: 'css' };
        });
      },
    },
  ],
};

async function build() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### 8.3 Tailwind Configuration

```javascript
// tailwind.config.js
module.exports = {
  content: ["src/webview-ui/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // VS Code theme colors
        "vscode-foreground": "var(--vscode-foreground)",
        "vscode-background": "var(--vscode-editor-background)",
        "vscode-border": "var(--vscode-panel-border)",
        // ... all VS Code color variables
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false, // Don't reset VS Code styles
  },
};
```

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// Test structure
tests/
├── extension/
│   ├── dashboard-panel-manager.test.ts
│   ├── rpc-handlers.test.ts
│   └── message-protocol.test.ts
├── webview/
│   ├── components/
│   │   ├── Button.test.tsx
│   │   ├── Table.test.tsx
│   │   └── HealthCard.test.tsx
│   ├── tabs/
│   │   ├── OverviewTab.test.tsx
│   │   ├── AgentsTab.test.tsx
│   │   └── TasksTab.test.tsx
│   └── stores/
│       ├── dashboard-store.test.ts
│       └── message-bus.test.ts
```

**Test Requirements**:

- **Component Tests**: All UI components with props, events, edge cases
- **RPC Tests**: Message protocol, error handling, correlation IDs
- **Store Tests**: State management, updates, persistence
- **Integration Tests**: Extension ↔ Webview communication
- **Coverage Target**: >80% line coverage

### 9.2 E2E Tests

```typescript
// tests/e2e/dashboard.test.ts
describe("AETHER Dashboard E2E", () => {
  test("opens dashboard with Ctrl+Shift+A", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("aether.dashboard");

    // Assert dashboard opens
    expect(vscode.window.activeTextEditor).toBeUndefined();
    // Assert webview panel exists with correct viewType
  });

  test("navigates between tabs", async () => {
    // Open dashboard, click tabs, verify content changes
  });

  test("submits task and sees it in tasks tab", async () => {
    // Navigate to tasks, submit new task, verify it appears
  });
});
```

### 9.3 Performance Tests

```typescript
// tests/performance/bundle-size.test.ts
test("webview bundle size under 210KB", async () => {
  const bundleSize = await getBundleSize("dist/webview.js");
  expect(bundleSize).toBeLessThan(210 * 1024); // 210KB
});

test("dashboard loads under 500ms", async () => {
  const startTime = performance.now();
  await openDashboard();
  const loadTime = performance.now() - startTime;
  expect(loadTime).toBeLessThan(500);
});
```

### 9.4 Manual Test Plan

**Accessibility Testing Matrix**:

| Test Case | Tools/Method | Expected Result |
|-----------|--------------|----------------|
| **Screen Reader Navigation** | NVDA/JAWS | All tabs, buttons, status cards announced correctly |
| **Keyboard-Only Navigation** | Tab/Shift+Tab, Arrow keys | Full dashboard navigable without mouse |
| **High Contrast Mode** | Windows High Contrast | All elements visible with proper contrast ratios |
| **Custom VS Code Themes** | Dark+, Light+, Monokai | Dashboard inherits theme colors correctly |
| **Font Scaling** | 150%, 200% zoom | UI remains usable, no text truncation |
| **Narrow Panels** | 300px width | Components stack/wrap appropriately |

**Theme and Visual Testing**:

| Scenario | Steps | Validation |
|----------|-------|------------|
| **Light/Dark Theme Switch** | 1. Open dashboard in light theme<br>2. Switch to dark theme<br>3. Verify all tabs | No flickering, colors update immediately |
| **VS Code Theme Change** | 1. Change VS Code theme while dashboard open<br>2. Verify color inheritance | Dashboard colors update to match VS Code |
| **Color Customization** | 1. Modify VS Code color settings<br>2. Reload dashboard | Custom colors reflected in dashboard |

**Responsive Layout Testing**:

| Panel Width | Expected Behavior | Test Method |
|-------------|-------------------|-------------|
| **1200px+** | Full layout, all columns visible | Drag panel to full width |
| **800-1200px** | Condensed layout, some stacking | Medium width testing |
| **300-800px** | Mobile-like layout, full stacking | Narrow panel testing |
| **<300px** | Minimal layout, scrolling | Extreme narrow testing |

**Keyboard Navigation Testing**:

| Flow | Key Sequence | Expected Result |
|------|--------------|-----------------|
| **Tab Navigation** | `Tab` through all tabs | Each tab gets focus, Enter activates |
| **Agent Hierarchy** | `Tab` to flow, `Arrow` keys to navigate | Focus moves between agent nodes |
| **Task List** | `Arrow` keys in task list | Focus moves between tasks, Space expands |
| **Form Inputs** | `Tab` through task form | All inputs accessible, validation on blur |
| **Modal Dialogs** | `Esc` to close, `Tab` to navigate | Proper focus trapping and restoration |

**Browser Zoom Testing**:

| Zoom Level | Test Focus | Pass Criteria |
|------------|------------|---------------|
| **50%** | Overall layout | No overlapping elements, readable text |
| **100%** | Standard experience | Baseline for all other tests |
| **150%** | Accessibility compliance | Text remains readable, UI functional |
| **200%** | High zoom accessibility | Critical functions still accessible |
| **300%** | Extreme zoom | Basic navigation possible |

**Performance Manual Testing**:

| Scenario | Measurement Method | Target |
|----------|-------------------|---------|
| **Cold Start** | Stopwatch from command to visible | <500ms |
| **Tab Switching** | Stopwatch between tab clicks | <100ms |
| **Large Agent List** | 50+ agents, scroll performance | Smooth scrolling, no lag |
| **Memory Usage** | VS Code Developer Tools | <100MB total |
| **Extended Usage** | 4+ hour session | No memory leaks, stable performance |

## 10. Migration Plan

### 10.1 Phase-by-Phase Migration

**Phase 1: Foundation (Week 1)**

- Set up Preact + Tailwind build
- Create base component library (Button, Input, Card, etc.)
- Implement message bus and RPC protocol
- Basic dashboard shell with empty tabs

**Phase 2: Overview & Health (Week 2)**

- Migrate Overview tab from vanilla DOM
- Implement health cards and system status
- Add real-time status updates
- Quick actions integration

**Phase 3: Agents Visualization (Week 3)**

- Implement React Flow agent hierarchy
- Agent search and filtering
- Agent detail panel
- Status indicators and real-time updates

**Phase 4: Task Management (Week 4)**

- Task list/tree view
- Task submission form
- Progress tracking and real-time updates
- Cancel/retry functionality

**Phase 5: Chat Integration (Week 5)**

- Rich chat interface with markdown-it
- Code block rendering with Prism
- Apply button functionality
- Slash command integration

**Phase 6: Approvals & Memory (Week 6)**

- Approval workflow UI
- Diff viewer implementation
- Memory search interface
- Knowledge browsing

**Phase 7: Settings & Polish (Week 7)**

- Settings form generation
- Configuration validation
- Final polish and bug fixes
- Performance optimization

### 10.2 Existing Panel Migration Strategy

**Existing Panels to be Replaced**:

| Current Panel | File Location | Command | Dashboard Tab | Migration Strategy |
|---------------|---------------|---------|---------------|-------------------|
| `OrchestratorPanel` | `src/panels/orchestrator.ts` | `aether.showOrchestrator` | Overview + Agents | **Phase 2**: Redirect command to `aether.dashboard`, deprecate file in v2.0 |
| `CostDashboardPanel` | `src/panels/task-history.ts` | `aether.showCosts` | Tasks (cost view) | **Phase 4**: Extract cost logic, redirect command, deprecate file in v2.0 |
| `MemoryExplorerPanel` | `src/panels/memory-explorer.ts` | `aether.showMemory` | Memory | **Phase 6**: Redirect command to `aether.dashboard.memory`, deprecate file in v2.0 |
| `SettingsEditorPanel` | `src/panels/settings-editor.ts` | `aether.showSettings` | Settings | **Phase 7**: Redirect command to `aether.dashboard.settings`, deprecate file in v2.0 |

**Migration Steps**:

1. **Phase 1 (Foundation)**: Keep all existing panels functional, no breaking changes
2. **Phase 2-7 (Feature Migration)**: Each phase implements equivalent functionality in dashboard
3. **Command Redirection**: Update existing commands to open dashboard tabs instead of separate panels:
   ```typescript
   // Migration wrapper commands
   vscode.commands.registerCommand("aether.showOrchestrator", () => {
     vscode.commands.executeCommand("aether.dashboard", "overview");
   });
   ```
4. **Deprecation Warnings**: Show deprecation notices in separate panels directing users to dashboard
5. **v2.0 Cleanup**: Remove old panel files, keep command redirects for backward compatibility

**Editor Integration Migration**:

| Component | File Location | Integration Plan |
|-----------|---------------|------------------|
| CodeLens Provider | `src/editor/codelens.ts` | **Phase 4**: "Ask Agent" opens Tasks tab, "Test" submits to dashboard task queue |
| Diagnostics Provider | `src/editor/diagnostics.ts` | **Phase 2**: Agent warnings link to Overview tab, suggestions open relevant tabs |
| Status Bar | `src/status/status-bar.ts` | **Phase 1**: Update click handler from `aether.showOrchestrator` to `aether.dashboard` |

### 10.3 Backward Compatibility

During migration:

- Keep existing sidebar TreeViews functional
- Maintain Chat Participant API
- Preserve existing WebviewPanels as fallbacks
- Gradual feature migration without breaking changes

### 10.3 Backward Compatibility

During migration:

- Keep existing sidebar TreeViews functional
- Maintain Chat Participant API (`@aether` commands continue to work)
- Preserve existing WebviewPanel behavior as fallbacks during transition
- All existing commands redirect to appropriate dashboard tabs
- Gradual feature migration without breaking existing workflows

### 10.4 File-Level Migration Mapping

**Files to Modify**:
```
src/extension.ts                     → Add dashboard commands, register panel manager
src/panels/dashboard-panel-manager.ts → New file (main dashboard controller)
src/webview-ui/                      → New directory (Preact components)
src/editor/codelens.ts              → Update click handlers to open dashboard
src/editor/diagnostics.ts           → Update links to dashboard tabs  
src/status/status-bar.ts            → Update click handler to dashboard
package.json                        → Add Preact dependencies
esbuild.config.mjs                  → Add webview bundle config
```

**Files to Deprecate (keep until v2.0)**:
```
src/panels/orchestrator.ts          → Redirect to dashboard overview
src/panels/task-history.ts          → Redirect to dashboard tasks
src/panels/memory-explorer.ts       → Redirect to dashboard memory
src/panels/settings-editor.ts       → Redirect to dashboard settings
```

**Feature Parity Verification**:

| Feature | Current Location | New Location | Verification Method |
|---------|------------------|--------------|-------------------|
| Agent status monitoring | `orchestrator.ts` | Overview tab | Compare real-time updates, status accuracy |
| Task submission | Chat Participant | Tasks tab | Verify form fields, validation, submission flow |
| Cost tracking | `task-history.ts` | Tasks tab (cost view) | Compare cost calculations, data accuracy |
| Memory search | `memory-explorer.ts` | Memory tab | Compare search results, performance |
| Settings editing | `settings-editor.ts` | Settings tab | Verify all config sections, validation |
| Agent hierarchy | `orchestrator.ts` (basic) | Agents tab | Enhanced with React Flow visualization |

### 10.5 Data Migration

```typescript
// Migrate existing state/preferences
interface MigrationManager {
  migrateExistingState(): Promise<void>;
  preserveUserSettings(): Promise<void>;
  updateStorageSchema(): Promise<void>;
}
```

## 11. Performance Requirements

### 11.1 Bundle Size Targets

**Clarification**: Individual bundle targets (not combined totals from §3.4):

| Bundle       | Target | Maximum | Notes |
| ------------ | ------ | ------- | ----- |
| webview.js   | 180KB  | 210KB   | Preact app with all components |
| extension.js | 50KB   | 75KB    | Node.js extension host code |
| Total Assets | 250KB  | 300KB   | Combined download size |

This corrects the ambiguous wording in §3.4 where "180-210KB total" could be misinterpreted as the combined bundle size.

### 11.2 Runtime Performance

| Metric         | Target | Maximum |
| -------------- | ------ | ------- |
| Dashboard Load | 300ms  | 500ms   |
| Tab Switch     | 50ms   | 100ms   |
| RPC Round Trip | 10ms   | 50ms    |
| Memory Usage   | 50MB   | 100MB   |

### 11.3 Optimization Strategies

- **Code Splitting**: Lazy load tab components
- **Tree Shaking**: Only import used Tailwind classes
- **Preact Compat**: 3KB vs React 42KB
- **Bundle Analysis**: webpack-bundle-analyzer equivalent
- **Memory Management**: Proper cleanup in useEffect

## 12. Accessibility Requirements

### 12.1 WCAG 2.1 AA Compliance

**Level A Requirements**:

- All images have alt text
- Proper heading hierarchy (h1 → h2 → h3)
- Keyboard navigation for all interactive elements
- No color-only information conveyance

**Level AA Requirements**:

- 4.5:1 color contrast ratio for normal text
- 3:1 color contrast ratio for large text
- Text can be resized to 200% without horizontal scrolling
- Focus indicators are clearly visible

### 12.2 Implementation Details

```typescript
// Accessibility props for components
interface AccessibilityProps {
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-expanded"?: boolean;
  role?: string;
  tabIndex?: number;
}

// Focus management
const useFocusManagement = () => {
  const trapFocus = (element: HTMLElement) => {
    // Implement focus trap for modals
  };

  const restoreFocus = (element: HTMLElement) => {
    // Restore focus after modal closes
  };
};

// Screen reader announcements
const useAnnouncements = () => {
  const announce = (
    message: string,
    priority: "polite" | "assertive" = "polite",
  ) => {
    // Create live region for announcements
  };
};
```

### 12.3 Testing Accessibility

```typescript
// tests/a11y/accessibility.test.ts
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

test('Dashboard has no accessibility violations', async () => {
  const { container } = render(<App />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

test('Keyboard navigation works', async () => {
  render(<App />);

  // Tab through all interactive elements
  const interactiveElements = screen.getAllByRole('button');
  interactiveElements.forEach(element => {
    expect(element).toHaveAttribute('tabIndex');
  });
});
```

## 13. Security Requirements

### 13.1 Content Security Policy

```typescript
// Strict CSP for webview with justified exceptions
const getCSP = (nonce: string) => `
  default-src 'none';
  script-src 'nonce-${nonce}';
  style-src 'unsafe-inline';
  img-src data: https:;
  font-src data:;
  connect-src 'none';
`;

/**
 * CSP Exception Justifications:
 * 
 * 1. style-src 'unsafe-inline': Required for dynamic Tailwind CSS generation
 *    and VS Code theme variable injection. Styles are generated at build time
 *    and runtime theme switching requires inline styles for CSS variables.
 *    Risk: Minimal - no user-generated styles, only framework and theme styles.
 * 
 * 2. script-src 'nonce-${nonce}': Uses cryptographic nonce for script security
 *    instead of 'unsafe-inline'. This is the recommended secure approach.
 * 
 * 3. img-src data: https:: Allows base64 encoded images (for icons) and HTTPS
 *    images (for agent avatars). No HTTP allowed.
 * 
 * 4. font-src data:: Allows embedded fonts for consistent UI rendering.
 */

// Apply CSP to webview
this.panel.webview.html = `
  <meta http-equiv="Content-Security-Policy" content="${getCSP(nonce)}">
`;
```

### 13.2 Markdown Security

```typescript
// Secure markdown rendering with sanitization
import DOMPurify from "isomorphic-dompurify";
import MarkdownIt from "markdown-it";

const createSecureMarkdownRenderer = () => {
  const md = new MarkdownIt({
    html: false, // Disable raw HTML in markdown
    linkify: true,
    typographer: true,
  });

  return {
    render: (content: string): string => {
      const rendered = md.render(content);
      
      // Sanitize rendered HTML to prevent XSS
      return DOMPurify.sanitize(rendered, {
        ALLOWED_TAGS: [
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'p', 'br', 'strong', 'em', 'u', 's',
          'ul', 'ol', 'li', 'blockquote',
          'code', 'pre', 'a', 'table', 'thead',
          'tbody', 'tr', 'td', 'th'
        ],
        ALLOWED_ATTR: ['href', 'class', 'id'],
        ALLOWED_URI_REGEXP: /^https?:\/\//,
      });
    }
  };
};
```

### 13.3 Input Sanitization

### 13.3 Input Sanitization

```typescript
// Sanitize all user inputs
import DOMPurify from "isomorphic-dompurify";

const sanitizeInput = (input: string): string => {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "code", "pre"],
    ALLOWED_ATTR: [],
  });
};

// Validate RPC messages
const validateMessage = (message: any): message is WebviewRequest => {
  return (
    typeof message === "object" &&
    typeof message.id === "string" &&
    typeof message.type === "string" &&
    typeof message.method === "string"
  );
};
```

### 13.4 Data Protection

```typescript
// Never log sensitive data
const createSecureLogger = () => {
  const SENSITIVE_FIELDS = ["apiKey", "password", "token", "secret"];

  const sanitizeLog = (obj: any): any => {
    if (typeof obj !== "object") return obj;

    const sanitized = { ...obj };
    SENSITIVE_FIELDS.forEach((field) => {
      if (field in sanitized) {
        sanitized[field] = "***REDACTED***";
      }
    });
    return sanitized;
  };
};

// Encrypt stored configuration
const encryptConfig = async (config: Config): Promise<string> => {
  // Use VS Code's built-in secrets storage
  const encrypted = await context.secrets.store(
    "aether.config",
    JSON.stringify(config),
  );
  return encrypted;
};
```

## 14. Success Criteria

### 14.1 Technical Success Criteria

| Criterion                 | Measurement          | Target          |
| ------------------------- | -------------------- | --------------- |
| SC-001: Bundle Size       | esbuild output size  | <210KB total    |
| SC-002: Load Performance  | Time to interactive  | <500ms          |
| SC-003: Memory Efficiency | VS Code memory usage | <100MB increase |
| SC-004: Accessibility     | axe violations       | 0 violations    |
| SC-005: Test Coverage     | Jest coverage report | >80% lines      |

### 14.2 User Experience Success Criteria

| Criterion                   | Measurement                                       | Target                    |
| --------------------------- | ------------------------------------------------- | ------------------------- |
| SC-006: Task Completion     | User can submit task via dashboard                | 100% success rate         |
| SC-007: Agent Discovery     | User can find agent by capability                 | <10s average time         |
| SC-008: Status Visibility   | User sees system health immediately               | 100% information accuracy |
| SC-009: Approval Efficiency | User can approve/reject changes                   | <30s per approval         |
| SC-010: Chat Productivity   | User prefers dashboard chat over Chat Participant | >70% preference           |

### 14.3 Business Success Criteria

| Criterion                      | Measurement                   | Target             |
| ------------------------------ | ----------------------------- | ------------------ |
| SC-011: User Adoption          | Dashboard usage vs old panels | >80% adoption      |
| SC-012: Task Throughput        | Tasks submitted per day       | 2x increase        |
| SC-013: Error Reduction        | User-reported bugs            | <50% vs current    |
| SC-014: Feature Discovery      | Users find advanced features  | >60% feature usage |
| SC-015: Developer Satisfaction | User feedback score           | >4.5/5 average     |

## 15. Acceptance Checklist

### 15.1 Functional Completeness

- [ ] All 7 tabs implemented and functional
- [ ] RPC protocol working with 0% message loss
- [ ] Real-time updates functioning across all views
- [ ] All existing functionality preserved during migration
- [ ] Error handling and loading states implemented

### 15.2 Technical Quality

- [ ] Bundle size under 210KB
- [ ] Load time under 500ms
- [ ] Memory usage under 100MB increase
- [ ] Test coverage over 80%
- [ ] Zero accessibility violations

### 15.3 User Experience

- [ ] Intuitive navigation between tabs
- [ ] Responsive design works at all VS Code sizes
- [ ] Consistent with VS Code design language
- [ ] Keyboard shortcuts work as expected
- [ ] Error messages are helpful and actionable

### 15.4 Security & Reliability

- [ ] CSP properly configured
- [ ] No sensitive data in logs
- [ ] Input validation on all user inputs
- [ ] Graceful degradation when AETHER core offline
- [ ] State persistence works across VS Code restarts

### 15.5 Documentation & Deployment

- [ ] README updated with new features
- [ ] CHANGELOG.md documents all changes
- [ ] Package.json version bumped appropriately
- [ ] VSIX builds successfully
- [ ] Installation instructions verified

---

## Next Steps

1. **Review this specification** for completeness and accuracy
2. **Clarify any ambiguities** or missing requirements
3. **Approve the technical approach** and architectural decisions
4. **Begin implementation** using the **implementer agent**

**Recommended Handoff**:

> "Use the implementer agent to implement the spec at `h:\aether\aether-vscode\SPEC.md`"

---

_This specification follows Spec-Driven Development (SDD) methodology where code serves the specification, not vice versa. Implementation should adhere strictly to these requirements while maintaining flexibility for technical implementation details not specified herein._
