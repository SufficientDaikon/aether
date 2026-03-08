/** @jsxImportSource preact */
import { h } from "preact";
import { useState, useMemo } from "preact/hooks";
import { useAgentsStore } from "../stores";
import {
  Card,
  Badge,
  Button,
  Input,
  Select,
  EmptyState,
  Spinner,
} from "../components/ui";
import { AgentHierarchyGraph } from "../components/AgentHierarchyGraph";
import type { Agent } from "../lib/types";
import { formatMs, formatRelativeTime, formatNumber } from "../lib/formatters";

const tierColors: Record<string, { bg: string; text: string; label: string }> =
  {
    master: { bg: "tier-master-bg", text: "tier-master", label: "Master" },
    manager: { bg: "tier-manager-bg", text: "tier-manager", label: "Manager" },
    worker: { bg: "tier-worker-bg", text: "tier-worker", label: "Worker" },
  };

const statusIcons: Record<string, string> = {
  online: "🟢",
  busy: "🟡",
  offline: "⚫",
  error: "🔴",
};

function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
}) {
  const tier = tierColors[agent.tier] || tierColors.worker;
  return (
    <div
      class={`p-3 rounded-lg border cursor-pointer transition-all ${
        selected
          ? "border-vsc-focus bg-vsc-list-active/20"
          : "border-vsc-border hover:border-vsc-focus/50"
      } ${tier.bg}`}
      onClick={onClick}
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-sm">{statusIcons[agent.status] || "⚫"}</span>
          <div>
            <p class={`text-sm font-semibold ${tier.text}`}>
              {agent.name || agent.id}
            </p>
            <p class="text-[11px] text-vsc-desc">
              {agent.capabilities.slice(0, 3).join(", ")}
            </p>
          </div>
        </div>
        <Badge
          variant={
            agent.tier === "master"
              ? "warning"
              : agent.tier === "manager"
                ? "info"
                : "success"
          }
          size="sm"
        >
          {tier.label}
        </Badge>
      </div>
      {agent.currentTask && (
        <p class="text-[11px] text-vsc-desc mt-1.5 truncate">
          📋 {agent.currentTask}
        </p>
      )}
    </div>
  );
}

function AgentDetail({ agent }: { agent: Agent }) {
  const tier = tierColors[agent.tier] || tierColors.worker;
  return (
    <div class="animate-slide-in space-y-3">
      <Card>
        <div class="flex items-center gap-3 mb-3">
          <div
            class={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${tier.bg}`}
          >
            {agent.tier === "master"
              ? "👑"
              : agent.tier === "manager"
                ? "📊"
                : "⚡"}
          </div>
          <div>
            <h3 class={`text-sm font-bold ${tier.text}`}>
              {agent.name || agent.id}
            </h3>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="text-xs">{statusIcons[agent.status]}</span>
              <span class="text-xs text-vsc-desc capitalize">
                {agent.status}
              </span>
            </div>
          </div>
        </div>

        <div class="space-y-2 text-xs">
          <div class="flex justify-between">
            <span class="text-vsc-desc">ID</span>
            <span class="font-mono">{agent.id}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-vsc-desc">Tier</span>
            <Badge
              variant={
                agent.tier === "master"
                  ? "warning"
                  : agent.tier === "manager"
                    ? "info"
                    : "success"
              }
            >
              {tier.label}
            </Badge>
          </div>
          <div class="flex justify-between">
            <span class="text-vsc-desc">Completed Tasks</span>
            <span>{formatNumber(agent.completedTasks)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-vsc-desc">Avg Response</span>
            <span>{formatMs(agent.avgResponseTime)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-vsc-desc">Last Seen</span>
            <span>{formatRelativeTime(agent.lastSeen)}</span>
          </div>
          {agent.parent && (
            <div class="flex justify-between">
              <span class="text-vsc-desc">Parent</span>
              <span class="font-mono">{agent.parent}</span>
            </div>
          )}
          {agent.children.length > 0 && (
            <div class="flex justify-between">
              <span class="text-vsc-desc">Children</span>
              <span>{agent.children.length} agents</span>
            </div>
          )}
        </div>
      </Card>

      {agent.capabilities.length > 0 && (
        <Card title="Capabilities">
          <div class="flex flex-wrap gap-1">
            {agent.capabilities.map((cap) => (
              <Badge key={cap} variant="default">
                {cap}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {agent.currentTask && (
        <Card title="Current Task">
          <p class="text-xs text-vsc-fg">{agent.currentTask}</p>
        </Card>
      )}
    </div>
  );
}

export function AgentsView() {
  const agents = useAgentsStore((s) => s.agents);
  const searchTerm = useAgentsStore((s) => s.searchTerm);
  const setSearch = useAgentsStore((s) => s.setSearch);
  const selectedAgent = useAgentsStore((s) => s.selectedAgent);
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "graph">("graph");

  const agentList = useMemo(() => {
    let list = Object.values(agents);
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(
        (a) =>
          a.id.toLowerCase().includes(lower) ||
          a.name.toLowerCase().includes(lower) ||
          a.capabilities.some((c) => c.toLowerCase().includes(lower)),
      );
    }
    if (tierFilter !== "all") list = list.filter((a) => a.tier === tierFilter);
    if (statusFilter !== "all")
      list = list.filter((a) => a.status === statusFilter);
    return list.sort((a, b) => {
      const tierOrder = { master: 0, manager: 1, worker: 2 };
      return (tierOrder[a.tier] ?? 3) - (tierOrder[b.tier] ?? 3);
    });
  }, [agents, searchTerm, tierFilter, statusFilter]);

  const selected = selectedAgent ? agents[selectedAgent] : null;

  if (Object.keys(agents).length === 0) {
    return (
      <div class="p-4 h-full">
        <EmptyState
          icon="🤖"
          title="No Agents Found"
          description="Connect to AETHER runtime to see the agent hierarchy."
        />
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full animate-fade-in">
      {/* Toolbar */}
      <div class="flex items-center gap-2 p-2 border-b border-vsc-border">
        <div class="flex bg-vsc-sidebar-bg rounded border border-vsc-border">
          <button
            class={`px-2.5 py-1 text-xs transition-colors rounded-l ${viewMode === "graph" ? "bg-vsc-btn-bg text-vsc-btn-fg" : "text-vsc-desc hover:text-vsc-fg"}`}
            onClick={() => setViewMode("graph")}
            title="Hierarchy Graph"
          >◉ Graph</button>
          <button
            class={`px-2.5 py-1 text-xs transition-colors rounded-r ${viewMode === "list" ? "bg-vsc-btn-bg text-vsc-btn-fg" : "text-vsc-desc hover:text-vsc-fg"}`}
            onClick={() => setViewMode("list")}
            title="Agent List"
          >☰ List</button>
        </div>
        <div class="text-[11px] text-vsc-desc ml-auto">
          {agentList.length} agents
        </div>
      </div>

      {viewMode === "graph" ? (
        <div class="flex flex-1 overflow-hidden">
          <div class={selected ? "w-2/3" : "w-full"}>
            <AgentHierarchyGraph
              agents={agentList}
              selectedAgent={selectedAgent}
              onSelectAgent={selectAgent}
            />
          </div>
          {selected && (
            <div class="w-1/3 overflow-y-auto p-3 border-l border-vsc-border">
              <div class="flex justify-between items-center mb-3">
                <h3 class="text-sm font-semibold text-vsc-fg">Agent Details</h3>
                <Button variant="ghost" size="sm" onClick={() => selectAgent(null)}>✕</Button>
              </div>
              <AgentDetail agent={selected} />
            </div>
          )}
        </div>
      ) : (
        <div class="flex flex-1 overflow-hidden">
          {/* Agent List */}
          <div class={`${selected ? "w-1/2" : "w-full"} border-r border-vsc-border flex flex-col`}>
            {/* Filters */}
            <div class="p-3 border-b border-vsc-border space-y-2">
              <Input placeholder="Search agents..." value={searchTerm} onChange={setSearch} />
              <div class="flex gap-2">
                <Select
                  value={tierFilter}
                  onChange={setTierFilter}
                  options={[
                    { label: "All Tiers", value: "all" },
                    { label: "Master", value: "master" },
                    { label: "Manager", value: "manager" },
                    { label: "Worker", value: "worker" },
                  ]}
                />
                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { label: "All Status", value: "all" },
                    { label: "Online", value: "online" },
                    { label: "Busy", value: "busy" },
                    { label: "Offline", value: "offline" },
                    { label: "Error", value: "error" },
                  ]}
                />
              </div>
            </div>

            {/* Agent Grid */}
            <div class="flex-1 overflow-y-auto p-3 space-y-2">
              {agentList.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgent === agent.id}
                  onClick={() => selectAgent(selectedAgent === agent.id ? null : agent.id)}
                />
              ))}
            </div>
          </div>

          {/* Detail Panel */}
          {selected && (
            <div class="w-1/2 overflow-y-auto p-3">
              <div class="flex justify-between items-center mb-3">
                <h3 class="text-sm font-semibold text-vsc-fg">Agent Details</h3>
                <Button variant="ghost" size="sm" onClick={() => selectAgent(null)}>✕</Button>
              </div>
              <AgentDetail agent={selected} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
