// Tests for all Zustand stores
// Runs in jsdom environment

import { describe, it, expect, beforeEach } from "vitest";
import {
  useDashboardStore,
  useSystemStore,
  useAgentsStore,
  useTasksStore,
  useChatStore,
  useSidebarStore,
} from "../../webview-ui/stores";
import type { Agent, Task, ChatMessage, SystemStatus } from "../../webview-ui/lib/types";

// Helper to reset store state between tests
function resetAll() {
  useDashboardStore.setState({
    activeTab: "overview",
    sidebarOpen: true,
    connected: false,
    loading: true,
    error: null,
  });
  useSystemStore.setState({ status: null, lastUpdate: null });
  useAgentsStore.setState({ agents: {}, searchTerm: "", selectedAgent: null, filters: {} });
  useTasksStore.setState({ tasks: {}, selectedTask: null, expandedTasks: new Set() });
  useChatStore.setState({ messages: [], inputValue: "", selectedCommand: undefined, loading: false });
  useSidebarStore.setState({ activePanel: null, selectedAgentId: "cortex-0" });
}

const mockAgent: Agent = {
  id: "cortex-0",
  name: "Cortex",
  tier: "master",
  status: "online",
  capabilities: ["orchestration", "planning"],
  completedTasks: 10,
  avgResponseTime: 1200,
  lastSeen: new Date().toISOString(),
  children: ["system-architect", "product-visionary"],
};

const mockTask: Task = {
  id: "task_1",
  description: "Build authentication module",
  status: "running",
  progress: 45,
  assignedAgent: "cortex-0",
  subtasks: [],
  created: new Date().toISOString(),
};

const mockMessage: ChatMessage = {
  id: "msg_1",
  role: "user",
  content: "Hello AETHER",
  timestamp: new Date().toISOString(),
};

describe("useDashboardStore", () => {
  beforeEach(resetAll);

  it("has correct initial state", () => {
    const s = useDashboardStore.getState();
    expect(s.activeTab).toBe("overview");
    expect(s.connected).toBe(false);
    expect(s.loading).toBe(true);
    expect(s.error).toBeNull();
  });

  it("setActiveTab updates active tab", () => {
    useDashboardStore.getState().setActiveTab("agents");
    expect(useDashboardStore.getState().activeTab).toBe("agents");
  });

  it("toggleSidebar flips sidebarOpen", () => {
    expect(useDashboardStore.getState().sidebarOpen).toBe(true);
    useDashboardStore.getState().toggleSidebar();
    expect(useDashboardStore.getState().sidebarOpen).toBe(false);
    useDashboardStore.getState().toggleSidebar();
    expect(useDashboardStore.getState().sidebarOpen).toBe(true);
  });

  it("setConnected updates connection state", () => {
    useDashboardStore.getState().setConnected(true);
    expect(useDashboardStore.getState().connected).toBe(true);
  });

  it("setLoading updates loading state", () => {
    useDashboardStore.getState().setLoading(false);
    expect(useDashboardStore.getState().loading).toBe(false);
  });

  it("setError updates error state", () => {
    useDashboardStore.getState().setError("Connection lost");
    expect(useDashboardStore.getState().error).toBe("Connection lost");
  });

  it("clearError sets error to null", () => {
    useDashboardStore.getState().setError("some error");
    useDashboardStore.getState().setError(null);
    expect(useDashboardStore.getState().error).toBeNull();
  });
});

describe("useSystemStore", () => {
  beforeEach(resetAll);

  it("has null status initially", () => {
    expect(useSystemStore.getState().status).toBeNull();
    expect(useSystemStore.getState().lastUpdate).toBeNull();
  });

  it("updateStatus sets status and lastUpdate", () => {
    const mockStatus: SystemStatus = {
      agents: { total: 34, online: 30, busy: 4, offline: 0 },
      tasks: { active: 2, queued: 1, completed: 100, failed: 0 },
      memory: { used: 512000, available: 1073741824, cacheHits: 50, cacheMisses: 10 },
      cost: { today: 1.23, thisMonth: 15.0, lastMonth: 42.0 },
      uptime: 3600,
      version: "0.2.0",
    };

    useSystemStore.getState().updateStatus(mockStatus);
    const s = useSystemStore.getState();
    expect(s.status).toEqual(mockStatus);
    expect(s.lastUpdate).not.toBeNull();
  });
});

describe("useAgentsStore", () => {
  beforeEach(resetAll);

  it("starts with empty agents map", () => {
    expect(useAgentsStore.getState().agents).toEqual({});
  });

  it("setAgents populates the map by id", () => {
    useAgentsStore.getState().setAgents([mockAgent]);
    const agents = useAgentsStore.getState().agents;
    expect(Object.keys(agents)).toHaveLength(1);
    expect(agents["cortex-0"]).toEqual(mockAgent);
  });

  it("setAgents replaces existing agents", () => {
    useAgentsStore.getState().setAgents([mockAgent]);
    const agent2: Agent = { ...mockAgent, id: "forge-0", name: "Forge" };
    useAgentsStore.getState().setAgents([agent2]);
    expect(Object.keys(useAgentsStore.getState().agents)).toHaveLength(1);
    expect(useAgentsStore.getState().agents["forge-0"]).toBeDefined();
    expect(useAgentsStore.getState().agents["cortex-0"]).toBeUndefined();
  });

  it("updateAgent merges partial updates", () => {
    useAgentsStore.getState().setAgents([mockAgent]);
    useAgentsStore.getState().updateAgent("cortex-0", { status: "busy", completedTasks: 11 });
    const agent = useAgentsStore.getState().agents["cortex-0"];
    expect(agent.status).toBe("busy");
    expect(agent.completedTasks).toBe(11);
    expect(agent.name).toBe("Cortex"); // unchanged
  });

  it("selectAgent sets selectedAgent", () => {
    useAgentsStore.getState().selectAgent("cortex-0");
    expect(useAgentsStore.getState().selectedAgent).toBe("cortex-0");
  });

  it("selectAgent can be cleared with null", () => {
    useAgentsStore.getState().selectAgent("cortex-0");
    useAgentsStore.getState().selectAgent(null);
    expect(useAgentsStore.getState().selectedAgent).toBeNull();
  });

  it("setSearch updates search term", () => {
    useAgentsStore.getState().setSearch("react");
    expect(useAgentsStore.getState().searchTerm).toBe("react");
  });

  it("setFilters updates filters", () => {
    useAgentsStore.getState().setFilters({ tier: ["master", "manager"] });
    expect(useAgentsStore.getState().filters.tier).toEqual(["master", "manager"]);
  });
});

describe("useTasksStore", () => {
  beforeEach(resetAll);

  it("starts with empty tasks", () => {
    expect(useTasksStore.getState().tasks).toEqual({});
  });

  it("setTasks populates map by id", () => {
    useTasksStore.getState().setTasks([mockTask]);
    expect(Object.keys(useTasksStore.getState().tasks)).toHaveLength(1);
    expect(useTasksStore.getState().tasks["task_1"]).toEqual(mockTask);
  });

  it("updateTask merges partial updates", () => {
    useTasksStore.getState().setTasks([mockTask]);
    useTasksStore.getState().updateTask("task_1", { progress: 75, status: "completed" });
    const task = useTasksStore.getState().tasks["task_1"];
    expect(task.progress).toBe(75);
    expect(task.status).toBe("completed");
    expect(task.description).toBe("Build authentication module"); // unchanged
  });

  it("selectTask sets selectedTask", () => {
    useTasksStore.getState().selectTask("task_1");
    expect(useTasksStore.getState().selectedTask).toBe("task_1");
  });

  it("toggleExpanded adds then removes task from set", () => {
    useTasksStore.getState().toggleExpanded("task_1");
    expect(useTasksStore.getState().expandedTasks.has("task_1")).toBe(true);

    useTasksStore.getState().toggleExpanded("task_1");
    expect(useTasksStore.getState().expandedTasks.has("task_1")).toBe(false);
  });

  it("handles multiple expanded tasks", () => {
    useTasksStore.getState().toggleExpanded("task_1");
    useTasksStore.getState().toggleExpanded("task_2");
    const expanded = useTasksStore.getState().expandedTasks;
    expect(expanded.has("task_1")).toBe(true);
    expect(expanded.has("task_2")).toBe(true);
  });
});

describe("useChatStore", () => {
  beforeEach(resetAll);

  it("starts with no messages", () => {
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("addMessage appends to messages", () => {
    useChatStore.getState().addMessage(mockMessage);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]).toEqual(mockMessage);
  });

  it("addMessage preserves order", () => {
    const msg2: ChatMessage = { ...mockMessage, id: "msg_2", role: "assistant", content: "Hi!" };
    useChatStore.getState().addMessage(mockMessage);
    useChatStore.getState().addMessage(msg2);
    const messages = useChatStore.getState().messages;
    expect(messages[0].id).toBe("msg_1");
    expect(messages[1].id).toBe("msg_2");
  });

  it("setMessages replaces all messages", () => {
    useChatStore.getState().addMessage(mockMessage);
    const newMsg: ChatMessage = { ...mockMessage, id: "msg_fresh", content: "Fresh" };
    useChatStore.getState().setMessages([newMsg]);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe("msg_fresh");
  });

  it("setInput updates inputValue", () => {
    useChatStore.getState().setInput("/run build my feature");
    expect(useChatStore.getState().inputValue).toBe("/run build my feature");
  });

  it("setCommand updates selectedCommand", () => {
    useChatStore.getState().setCommand("plan");
    expect(useChatStore.getState().selectedCommand).toBe("plan");
  });

  it("setCommand can clear with undefined", () => {
    useChatStore.getState().setCommand("plan");
    useChatStore.getState().setCommand(undefined);
    expect(useChatStore.getState().selectedCommand).toBeUndefined();
  });

  it("setLoading updates loading", () => {
    useChatStore.getState().setLoading(true);
    expect(useChatStore.getState().loading).toBe(true);
  });
});

describe("useSidebarStore", () => {
  beforeEach(resetAll);

  it("starts with null active panel and cortex-0 selected", () => {
    const s = useSidebarStore.getState();
    expect(s.activePanel).toBeNull();
    expect(s.selectedAgentId).toBe("cortex-0");
  });

  it("setActivePanel updates panel", () => {
    useSidebarStore.getState().setActivePanel("tasks");
    expect(useSidebarStore.getState().activePanel).toBe("tasks");
  });

  it("setActivePanel can be set to null to collapse", () => {
    useSidebarStore.getState().setActivePanel("agents");
    useSidebarStore.getState().setActivePanel(null);
    expect(useSidebarStore.getState().activePanel).toBeNull();
  });

  it("setSelectedAgentId updates selection", () => {
    useSidebarStore.getState().setSelectedAgentId("forge-0");
    expect(useSidebarStore.getState().selectedAgentId).toBe("forge-0");
  });
});
