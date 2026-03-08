/** @jsxImportSource preact */
import { h } from "preact";
import { useSystemStore, useDashboardStore } from "../stores";
import { Card, Badge, Button, Spinner } from "../components/ui";
import {
  formatCost,
  formatBytes,
  formatNumber,
  formatDuration,
} from "../lib/formatters";

interface HealthCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  status: "healthy" | "warning" | "error";
  icon: string;
  onClick?: () => void;
}

function HealthCard({
  title,
  value,
  subtitle,
  status,
  icon,
  onClick,
}: HealthCardProps) {
  const statusColor = {
    healthy: "border-emerald-500/30",
    warning: "border-amber-500/30",
    error: "border-red-500/30",
  };
  const dotColor = {
    healthy: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-red-400",
  };

  return (
    <Card
      className={`${statusColor[status]} cursor-pointer hover:border-vsc-focus`}
      onClick={onClick}
    >
      <div class="flex items-start justify-between">
        <div>
          <span class="text-lg">{icon}</span>
          <p class="text-xs text-vsc-desc mt-1">{title}</p>
          <p class="text-xl font-bold text-vsc-fg mt-0.5">{value}</p>
          {subtitle && (
            <p class="text-[11px] text-vsc-desc mt-0.5">{subtitle}</p>
          )}
        </div>
        <span
          class={`w-2 h-2 rounded-full ${dotColor[status]} animate-pulse-dot`}
        />
      </div>
    </Card>
  );
}

export function OverviewView() {
  const status = useSystemStore((s) => s.status);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const connected = useDashboardStore((s) => s.connected);
  const loading = useDashboardStore((s) => s.loading);

  if (loading) {
    return (
      <div class="flex items-center justify-center h-full">
        <Spinner size={24} />
        <span class="ml-2 text-sm text-vsc-desc">
          Connecting to AETHER runtime...
        </span>
      </div>
    );
  }

  if (!status) {
    return (
      <div class="flex flex-col items-center justify-center h-full text-center p-8">
        <span class="text-4xl mb-4">⚡</span>
        <h2 class="text-lg font-semibold text-vsc-fg">AETHER Dashboard</h2>
        <p class="text-sm text-vsc-desc mt-2 max-w-md">
          {connected
            ? "Loading system status..."
            : "Not connected to AETHER runtime. Ensure the MCP server is running."}
        </p>
        {!connected && (
          <Button
            variant="primary"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Retry Connection
          </Button>
        )}
      </div>
    );
  }

  const agentHealth =
    status.agents.offline > 3
      ? "error"
      : status.agents.offline > 0
        ? "warning"
        : "healthy";
  const taskHealth =
    status.tasks.failed > 5
      ? "error"
      : status.tasks.failed > 0
        ? "warning"
        : "healthy";
  const memHealth =
    status.memory.used > status.memory.available * 0.9
      ? "error"
      : status.memory.used > status.memory.available * 0.7
        ? "warning"
        : "healthy";
  const costHealth =
    status.cost.today > 50
      ? "error"
      : status.cost.today > 20
        ? "warning"
        : "healthy";

  return (
    <div class="p-4 space-y-4 overflow-y-auto h-full animate-fade-in">
      {/* Health Cards */}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HealthCard
          icon="🤖"
          title="Agents"
          value={`${status.agents.online}/${status.agents.total}`}
          subtitle={`${status.agents.busy} busy`}
          status={agentHealth}
          onClick={() => setActiveTab("agents")}
        />
        <HealthCard
          icon="📋"
          title="Tasks"
          value={formatNumber(status.tasks.active)}
          subtitle={`${status.tasks.queued} queued`}
          status={taskHealth}
          onClick={() => setActiveTab("tasks")}
        />
        <HealthCard
          icon="🧠"
          title="Memory"
          value={formatBytes(status.memory.used)}
          subtitle={`${Math.round((status.memory.cacheHits / (status.memory.cacheHits + status.memory.cacheMisses || 1)) * 100)}% hit rate`}
          status={memHealth}
          onClick={() => setActiveTab("memory")}
        />
        <HealthCard
          icon="💰"
          title="Cost Today"
          value={formatCost(status.cost.today)}
          subtitle={`${formatCost(status.cost.thisMonth)} this month`}
          status={costHealth}
          onClick={() => setActiveTab("settings")}
        />
      </div>

      {/* Quick Actions */}
      <Card title="Quick Actions">
        <div class="flex flex-wrap gap-2">
          <Button onClick={() => setActiveTab("tasks")}>📝 New Task</Button>
          <Button variant="secondary" onClick={() => setActiveTab("chat")}>
            💬 Open Chat
          </Button>
          <Button variant="secondary" onClick={() => setActiveTab("agents")}>
            🔍 Browse Agents
          </Button>
          <Button variant="secondary" onClick={() => setActiveTab("settings")}>
            ⚙️ Settings
          </Button>
        </div>
      </Card>

      {/* System Info */}
      <Card title="System Info">
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="flex justify-between">
            <span class="text-vsc-desc">Version</span>
            <span class="text-vsc-fg font-mono">
              {status.version || "0.2.0"}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-vsc-desc">Uptime</span>
            <span class="text-vsc-fg font-mono">
              {formatDuration(status.uptime)}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-vsc-desc">Completed Tasks</span>
            <span class="text-vsc-fg font-mono">
              {formatNumber(status.tasks.completed)}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-vsc-desc">Failed Tasks</span>
            <span
              class={`font-mono ${status.tasks.failed > 0 ? "text-red-400" : "text-vsc-fg"}`}
            >
              {status.tasks.failed}
            </span>
          </div>
        </div>
      </Card>

      {/* Connection Status */}
      <div class="flex items-center gap-2 text-[11px] text-vsc-desc">
        <span
          class={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`}
        />
        {connected ? "Connected to AETHER runtime" : "Disconnected"}
      </div>
    </div>
  );
}
