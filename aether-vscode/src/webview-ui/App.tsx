/** @jsxImportSource preact */
import { h, render } from "preact";
import { Tabs } from "./components/ui";
import { useDashboardStore } from "./stores";
import { useSystemPolling, useAgents, useTasks } from "./hooks/useAether";
import { initMessageBus, signalReady, onEvent } from "./lib/message-bus";
import { OverviewView } from "./views/OverviewView";
import { AgentsView } from "./views/AgentsView";
import { TasksView } from "./views/TasksView";
import { ChatView } from "./views/ChatView";
import { ApprovalsView } from "./views/ApprovalsView";
import { MemoryView } from "./views/MemoryView";
import { SettingsView } from "./views/SettingsView";
import type { TabId } from "./lib/types";
import "./index.css";

const TAB_ITEMS = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "agents", label: "Agents", icon: "🤖" },
  { id: "tasks", label: "Tasks", icon: "📋" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "approvals", label: "Approvals", icon: "✅" },
  { id: "memory", label: "Memory", icon: "🧠" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case "overview":
      return <OverviewView />;
    case "agents":
      return <AgentsView />;
    case "tasks":
      return <TasksView />;
    case "chat":
      return <ChatView />;
    case "approvals":
      return <ApprovalsView />;
    case "memory":
      return <MemoryView />;
    case "settings":
      return <SettingsView />;
    default:
      return <OverviewView />;
  }
}

function App() {
  const activeTab = useDashboardStore((s) => s.activeTab);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const connected = useDashboardStore((s) => s.connected);

  // Initialize data hooks
  useSystemPolling();
  useAgents();
  useTasks();

  // Listen for navigation from extension host
  onEvent("navigate", (tab: string) => {
    if (TAB_ITEMS.some((t) => t.id === tab)) {
      setActiveTab(tab as TabId);
    }
  });

  return (
    <div class="flex flex-col h-screen">
      {/* Header */}
      <div class="flex items-center justify-between px-3 py-1.5 border-b border-vsc-border bg-vsc-sidebar-bg">
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold text-vsc-fg">⚡ AETHER</span>
          <span
            class={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`}
          />
        </div>
      </div>

      {/* Tab bar */}
      <Tabs
        tabs={TAB_ITEMS}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
      />

      {/* Content */}
      <div class="flex-1 overflow-hidden">
        <TabContent tab={activeTab} />
      </div>
    </div>
  );
}

// Boot
initMessageBus();
const root = document.getElementById("root");
if (root) {
  render(<App />, root);
  signalReady();
}
