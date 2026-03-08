/** @jsxImportSource preact */
import { h } from "preact";
import { useState, useMemo, useRef, useCallback } from "preact/hooks";
import type { Agent } from "../lib/types";

interface GraphNode {
  id: string;
  agent: Agent;
  x: number;
  y: number;
  tier: "master" | "manager" | "worker";
}

interface GraphEdge {
  from: string;
  to: string;
}

const TIER_COLORS = {
  master: {
    fill: "#f5a623",
    glow: "rgba(245,166,35,0.35)",
    stroke: "#d48c1a",
    label: "👑",
  },
  manager: {
    fill: "#4a9eff",
    glow: "rgba(74,158,255,0.3)",
    stroke: "#3580d4",
    label: "📊",
  },
  worker: {
    fill: "#5cb85c",
    glow: "rgba(92,184,92,0.25)",
    stroke: "#47a047",
    label: "⚡",
  },
};

const STATUS_RING = {
  online: "#5cb85c",
  busy: "#f5a623",
  offline: "#666",
  error: "#d9534f",
};

const NODE_RADIUS = { master: 28, manager: 22, worker: 16 };

function layoutNodes(agents: Agent[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const masters = agents.filter((a) => a.tier === "master");
  const managers = agents.filter((a) => a.tier === "manager");
  const workers = agents.filter((a) => a.tier === "worker");

  const W = 1200;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Layout masters at top
  const masterY = 60;
  masters.forEach((a, i) => {
    const x = W / 2 + (i - (masters.length - 1) / 2) * 160;
    nodes.push({ id: a.id, agent: a, x, y: masterY, tier: "master" });
  });

  // Layout managers in middle
  const managerY = 200;
  managers.forEach((a, i) => {
    const spacing = Math.min(180, (W - 100) / Math.max(managers.length, 1));
    const startX = (W - (managers.length - 1) * spacing) / 2;
    const x = startX + i * spacing;
    nodes.push({ id: a.id, agent: a, x, y: managerY, tier: "manager" });
  });

  // Layout workers at bottom — group by parent manager
  const workerY = 360;
  const managerIds = managers.map((m) => m.id);
  const grouped = new Map<string, Agent[]>();
  workers.forEach((w) => {
    const parent =
      w.parent && managerIds.includes(w.parent) ? w.parent : "__unassigned";
    if (!grouped.has(parent)) grouped.set(parent, []);
    grouped.get(parent)!.push(w);
  });

  // Find each manager's x position for clustering
  const managerXMap = new Map<string, number>();
  nodes
    .filter((n) => n.tier === "manager")
    .forEach((n) => managerXMap.set(n.id, n.x));

  let workerIdx = 0;
  const totalWorkers = workers.length;
  const workerSpacing = Math.min(65, (W - 60) / Math.max(totalWorkers, 1));
  const workerStartX = (W - (totalWorkers - 1) * workerSpacing) / 2;

  // Sort workers so they cluster near their parent manager
  const sortedWorkers = [...workers].sort((a, b) => {
    const ax = managerXMap.get(a.parent || "") ?? W / 2;
    const bx = managerXMap.get(b.parent || "") ?? W / 2;
    return ax - bx;
  });

  sortedWorkers.forEach((a) => {
    const x = workerStartX + workerIdx * workerSpacing;
    const yJitter = ((workerIdx % 3) - 1) * 18;
    nodes.push({ id: a.id, agent: a, x, y: workerY + yJitter, tier: "worker" });
    workerIdx++;
  });

  // Build edges from parent→child relationships
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  agents.forEach((a) => {
    if (a.parent && nodeMap.has(a.parent) && nodeMap.has(a.id)) {
      edges.push({ from: a.parent, to: a.id });
    }
  });

  return { nodes, edges };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
}

export function AgentHierarchyGraph({
  agents,
  selectedAgent,
  onSelectAgent,
}: {
  agents: Agent[];
  selectedAgent: string | null;
  onSelectAgent: (id: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => layoutNodes(agents), [agents]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.3, Math.min(2.5, z - e.deltaY * 0.001)));
  }, []);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button === 0 && (e.target as Element).tagName === "svg") {
        setDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (dragging) {
        setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      }
    },
    [dragging, dragStart],
  );

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return (
    <div class="relative w-full h-full overflow-hidden bg-vsc-bg">
      {/* Controls */}
      <div class="absolute top-2 right-2 z-10 flex gap-1">
        <button
          class="w-7 h-7 rounded bg-vsc-sidebar-bg border border-vsc-border text-vsc-fg text-sm hover:bg-vsc-list-hover transition-colors"
          onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
          title="Zoom in"
        >
          +
        </button>
        <button
          class="w-7 h-7 rounded bg-vsc-sidebar-bg border border-vsc-border text-vsc-fg text-sm hover:bg-vsc-list-hover transition-colors"
          onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}
          title="Zoom out"
        >
          −
        </button>
        <button
          class="w-7 h-7 rounded bg-vsc-sidebar-bg border border-vsc-border text-vsc-fg text-xs hover:bg-vsc-list-hover transition-colors"
          onClick={resetView}
          title="Reset view"
        >
          ⟲
        </button>
      </div>

      {/* Legend */}
      <div class="absolute bottom-2 left-2 z-10 flex gap-3 text-[10px] text-vsc-desc bg-vsc-sidebar-bg/80 px-2 py-1 rounded border border-vsc-border">
        <span class="flex items-center gap-1">
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ background: TIER_COLORS.master.fill }}
          />
          Master
        </span>
        <span class="flex items-center gap-1">
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ background: TIER_COLORS.manager.fill }}
          />
          Manager
        </span>
        <span class="flex items-center gap-1">
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ background: TIER_COLORS.worker.fill }}
          />
          Worker
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 1200 440"
        class="w-full h-full"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onWheel={handleWheel as any}
        onMouseDown={handleMouseDown as any}
        onMouseMove={handleMouseMove as any}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Tier labels */}
          <text
            x="20"
            y="60"
            fill="var(--vscode-descriptionForeground)"
            font-size="11"
            opacity="0.5"
          >
            MASTER
          </text>
          <text
            x="20"
            y="200"
            fill="var(--vscode-descriptionForeground)"
            font-size="11"
            opacity="0.5"
          >
            MANAGERS
          </text>
          <text
            x="20"
            y="350"
            fill="var(--vscode-descriptionForeground)"
            font-size="11"
            opacity="0.5"
          >
            WORKERS
          </text>

          {/* Tier separator lines */}
          <line
            x1="0"
            y1="130"
            x2="1200"
            y2="130"
            stroke="var(--vscode-editorWidget-border)"
            stroke-width="0.5"
            stroke-dasharray="4,4"
            opacity="0.3"
          />
          <line
            x1="0"
            y1="280"
            x2="1200"
            y2="280"
            stroke="var(--vscode-editorWidget-border)"
            stroke-width="0.5"
            stroke-dasharray="4,4"
            opacity="0.3"
          />

          {/* Edges */}
          {edges.map((edge) => {
            const from = nodeMap.get(edge.from);
            const to = nodeMap.get(edge.to);
            if (!from || !to) return null;
            const isHighlighted =
              selectedAgent === edge.from ||
              selectedAgent === edge.to ||
              hoveredNode === edge.from ||
              hoveredNode === edge.to;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={bezierPath(
                  from.x,
                  from.y + NODE_RADIUS[from.tier],
                  to.x,
                  to.y - NODE_RADIUS[to.tier],
                )}
                fill="none"
                stroke={
                  isHighlighted
                    ? TIER_COLORS[from.tier].fill
                    : "var(--vscode-editorWidget-border)"
                }
                stroke-width={isHighlighted ? 2 : 1}
                opacity={isHighlighted ? 0.8 : 0.2}
                class="transition-all duration-200"
              />
            );
          })}

          {/* Animated flow particles on edges of selected agent */}
          {selectedAgent &&
            edges
              .filter((e) => e.from === selectedAgent || e.to === selectedAgent)
              .map((edge) => {
                const from = nodeMap.get(edge.from);
                const to = nodeMap.get(edge.to);
                if (!from || !to) return null;
                const pathId = `flow-${edge.from}-${edge.to}`;
                return (
                  <g key={pathId}>
                    <path
                      id={pathId}
                      d={bezierPath(
                        from.x,
                        from.y + NODE_RADIUS[from.tier],
                        to.x,
                        to.y - NODE_RADIUS[to.tier],
                      )}
                      fill="none"
                      stroke="none"
                    />
                    <circle
                      r="3"
                      fill={TIER_COLORS[from.tier].fill}
                      opacity="0.9"
                    >
                      <animateMotion dur="2s" repeatCount="indefinite">
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                  </g>
                );
              })}

          {/* Nodes */}
          {nodes.map((node) => {
            const tier = TIER_COLORS[node.tier];
            const r = NODE_RADIUS[node.tier];
            const isSelected = selectedAgent === node.id;
            const isHovered = hoveredNode === node.id;
            const isBusy = node.agent.status === "busy";
            const statusColor =
              STATUS_RING[node.agent.status] || STATUS_RING.offline;

            return (
              <g
                key={node.id}
                class="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAgent(isSelected ? null : node.id);
                }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Glow for selected/hovered */}
                {(isSelected || isHovered) && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r + 8}
                    fill={tier.glow}
                    class="animate-pulse-dot"
                  />
                )}

                {/* Busy pulse ring */}
                {isBusy && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r + 4}
                    fill="none"
                    stroke={tier.fill}
                    stroke-width="1.5"
                    opacity="0.4"
                  >
                    <animate
                      attributeName="r"
                      from={r + 2}
                      to={r + 12}
                      dur="1.5s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      from="0.4"
                      to="0"
                      dur="1.5s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}

                {/* Status ring */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r + 2}
                  fill="none"
                  stroke={statusColor}
                  stroke-width="2"
                  opacity="0.6"
                />

                {/* Main node circle */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={isSelected ? tier.fill : `${tier.fill}33`}
                  stroke={tier.fill}
                  stroke-width={isSelected ? 2.5 : 1.5}
                  class="transition-all duration-200"
                />

                {/* Tier icon */}
                <text
                  x={node.x}
                  y={node.y + 1}
                  text-anchor="middle"
                  dominant-baseline="central"
                  font-size={node.tier === "worker" ? 10 : 14}
                >
                  {tier.label}
                </text>

                {/* Name label */}
                <text
                  x={node.x}
                  y={node.y + r + 14}
                  text-anchor="middle"
                  fill="var(--vscode-foreground)"
                  font-size={node.tier === "worker" ? 9 : 11}
                  font-weight={isSelected ? "bold" : "normal"}
                  opacity={isSelected || isHovered ? 1 : 0.7}
                >
                  {(node.agent.name || node.agent.id)
                    .replace(/-/g, " ")
                    .slice(0, 16)}
                </text>

                {/* Task indicator */}
                {node.agent.currentTask && (
                  <circle
                    cx={node.x + r - 2}
                    cy={node.y - r + 2}
                    r="4"
                    fill="#f5a623"
                    stroke="var(--vscode-editor-background)"
                    stroke-width="1.5"
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
