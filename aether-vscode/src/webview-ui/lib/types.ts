// Types shared between extension host and webview

export interface BaseMessage {
  id: string;
  type: string;
  timestamp: number;
}

export interface WebviewRequest extends BaseMessage {
  type: "request";
  method: string;
  params?: any;
}

export interface ExtensionResponse extends BaseMessage {
  type: "response";
  correlationId: string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export interface ExtensionEventMessage extends BaseMessage {
  type: "event";
  event: string;
  data?: any;
}

// System
export interface SystemStatus {
  agents: { total: number; online: number; busy: number; offline: number };
  tasks: { active: number; queued: number; completed: number; failed: number };
  memory: {
    used: number;
    available: number;
    cacheHits: number;
    cacheMisses: number;
  };
  cost: { today: number; thisMonth: number; lastMonth: number };
  uptime: number;
  version: string;
}

// Agent
export interface Agent {
  id: string;
  name: string;
  tier: "master" | "manager" | "worker";
  status: "online" | "offline" | "busy" | "error";
  capabilities: string[];
  currentTask?: string;
  completedTasks: number;
  avgResponseTime: number;
  lastSeen: string;
  parent?: string;
  children: string[];
}

// Task
export interface Task {
  id: string;
  description: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  assignedAgent: string;
  parentTask?: string;
  subtasks: string[];
  created: string;
  started?: string;
  completed?: string;
  result?: any;
  error?: string;
  estimatedCompletion?: string;
  actualDuration?: number;
}

// Chat
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  agent?: string;
  command?: string;
  codeBlocks?: CodeBlock[];
  attachments?: Attachment[];
}

export interface CodeBlock {
  id: string;
  language: string;
  code: string;
  filename?: string;
  applied: boolean;
}

export interface Attachment {
  id: string;
  type: "file" | "code" | "image" | "link";
  name: string;
  content?: string;
  url?: string;
  size?: number;
  mimeType?: string;
}

// Approval
export interface Approval {
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

export interface FileChange {
  path: string;
  type: "create" | "modify" | "delete";
  oldContent?: string;
  newContent?: string;
  diff?: string;
}

// Memory
export interface MemoryResult {
  id: string;
  type: "conversation" | "code" | "embedding" | "cache";
  content: string;
  score: number;
  source: string;
  timestamp: string;
  agent?: string;
  context?: Record<string, any>;
}

// Events
export type ExtensionEvent =
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

export type TabId =
  | "overview"
  | "agents"
  | "tasks"
  | "chat"
  | "approvals"
  | "memory"
  | "settings";
