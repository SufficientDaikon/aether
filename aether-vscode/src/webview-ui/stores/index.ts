import { create } from "zustand";
import type {
  TabId,
  SystemStatus,
  Agent,
  Task,
  ChatMessage,
  Approval,
  MemoryResult,
} from "../lib/types";

// Dashboard UI store
export interface DashboardState {
  activeTab: TabId;
  sidebarOpen: boolean;
  connected: boolean;
  loading: boolean;
  error: string | null;
  setActiveTab: (tab: TabId) => void;
  toggleSidebar: () => void;
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  activeTab: "overview",
  sidebarOpen: true,
  connected: false,
  loading: true,
  error: null,
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setConnected: (connected) => set({ connected }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

// System health store
export interface SystemState {
  status: SystemStatus | null;
  lastUpdate: string | null;
  updateStatus: (status: SystemStatus) => void;
}

export const useSystemStore = create<SystemState>((set) => ({
  status: null,
  lastUpdate: null,
  updateStatus: (status) =>
    set({ status, lastUpdate: new Date().toISOString() }),
}));

// Agents store
export interface AgentsState {
  agents: Record<string, Agent>;
  searchTerm: string;
  selectedAgent: string | null;
  filters: {
    status?: Agent["status"][];
    tier?: Agent["tier"][];
    capabilities?: string[];
  };
  setAgents: (agents: Agent[]) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  setSearch: (term: string) => void;
  selectAgent: (id: string | null) => void;
  setFilters: (filters: AgentsState["filters"]) => void;
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: {},
  searchTerm: "",
  selectedAgent: null,
  filters: {},
  setAgents: (agents) => {
    const map: Record<string, Agent> = {};
    agents.forEach((a) => (map[a.id] = a));
    set({ agents: map });
  },
  updateAgent: (id, updates) =>
    set((s) => ({
      agents: { ...s.agents, [id]: { ...s.agents[id], ...updates } },
    })),
  setSearch: (term) => set({ searchTerm: term }),
  selectAgent: (id) => set({ selectedAgent: id }),
  setFilters: (filters) => set({ filters }),
}));

// Tasks store
export interface TasksState {
  tasks: Record<string, Task>;
  selectedTask: string | null;
  expandedTasks: Set<string>;
  setTasks: (tasks: Task[]) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  selectTask: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: {},
  selectedTask: null,
  expandedTasks: new Set(),
  setTasks: (tasks) => {
    const map: Record<string, Task> = {};
    tasks.forEach((t) => (map[t.id] = t));
    set({ tasks: map });
  },
  updateTask: (id, updates) =>
    set((s) => ({
      tasks: { ...s.tasks, [id]: { ...s.tasks[id], ...updates } },
    })),
  selectTask: (id) => set({ selectedTask: id }),
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expandedTasks);
      next.has(id) ? next.delete(id) : next.add(id);
      return { expandedTasks: next };
    }),
}));

// Chat store
export interface ChatState {
  messages: ChatMessage[];
  inputValue: string;
  selectedCommand: string | undefined;
  loading: boolean;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setInput: (value: string) => void;
  setCommand: (cmd: string | undefined) => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  inputValue: "",
  selectedCommand: undefined,
  loading: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setInput: (value) => set({ inputValue: value }),
  setCommand: (cmd) => set({ selectedCommand: cmd }),
  setLoading: (loading) => set({ loading }),
}));
