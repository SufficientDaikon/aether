/** @jsxImportSource preact */
import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import { Card, Badge, Button, EmptyState, Spinner } from "../components/ui";
import { rpcCall } from "../lib/message-bus";
import type { Approval, FileChange } from "../lib/types";
import { formatRelativeTime } from "../lib/formatters";

const riskColors: Record<
  string,
  { badge: "success" | "warning" | "error"; icon: string }
> = {
  low: { badge: "success", icon: "🟢" },
  medium: { badge: "warning", icon: "🟡" },
  high: { badge: "error", icon: "🔴" },
};

function DiffBlock({ change }: { change: FileChange }) {
  const lines = (change.diff || "").split("\n");
  return (
    <div class="border border-vsc-border rounded overflow-hidden mt-2">
      <div class="flex items-center justify-between px-2 py-1 bg-vsc-sidebar-bg text-[11px]">
        <span class="font-mono text-vsc-fg">{change.path}</span>
        <Badge
          variant={
            change.type === "delete"
              ? "error"
              : change.type === "create"
                ? "success"
                : "info"
          }
          size="sm"
        >
          {change.type}
        </Badge>
      </div>
      <pre class="p-2 text-[11px] font-vsc-editor overflow-x-auto max-h-48">
        {lines.map((line, i) => {
          const color = line.startsWith("+")
            ? "text-emerald-400 bg-emerald-400/5"
            : line.startsWith("-")
              ? "text-red-400 bg-red-400/5"
              : "text-vsc-desc";
          return (
            <div key={i} class={color}>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function ApprovalCard({
  approval,
  onAction,
}: {
  approval: Approval;
  onAction: (id: string, action: "approve" | "reject") => void;
}) {
  const risk = riskColors[approval.riskLevel] || riskColors.low;
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="animate-fade-in">
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <span>{risk.icon}</span>
            <Badge variant={risk.badge} size="sm">
              {approval.riskLevel.toUpperCase()} RISK
            </Badge>
            <Badge variant="default" size="sm">
              {approval.type.replace(/_/g, " ")}
            </Badge>
          </div>
          <p class="text-xs text-vsc-fg mt-1.5 font-medium">
            {approval.description}
          </p>
          <div class="flex items-center gap-3 mt-1 text-[10px] text-vsc-desc">
            <span>Agent: {approval.agent}</span>
            <span>Task: {approval.task}</span>
            <span>{formatRelativeTime(approval.created)}</span>
          </div>
        </div>
      </div>

      {/* File Changes */}
      <div class="mt-3">
        <button
          class="text-[11px] text-vsc-link hover:underline"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▼" : "▶"} {approval.changes.length} file
          {approval.changes.length !== 1 ? "s" : ""} changed
        </button>
        {expanded &&
          approval.changes.map((change, i) => (
            <DiffBlock key={i} change={change} />
          ))}
      </div>

      {/* Actions */}
      <div class="flex gap-2 mt-3 pt-2 border-t border-vsc-border">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onAction(approval.id, "approve")}
        >
          ✓ Approve
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => onAction(approval.id, "reject")}
        >
          ✕ Reject
        </Button>
      </div>
    </Card>
  );
}

export function ApprovalsView() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApprovals = async () => {
    try {
      const data = await rpcCall<Approval[]>("getPendingApprovals");
      if (data) setApprovals(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    try {
      if (action === "approve") {
        await rpcCall("approveChange", { approvalId: id });
      } else {
        await rpcCall("rejectChange", {
          approvalId: id,
          reason: "Rejected via dashboard",
        });
      }
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Approval action failed:", err);
    }
  };

  const handleBatchApprove = async () => {
    const ids = approvals.filter((a) => a.riskLevel === "low").map((a) => a.id);
    if (ids.length === 0) return;
    try {
      await rpcCall("batchApprove", { approvalIds: ids });
      setApprovals((prev) => prev.filter((a) => !ids.includes(a.id)));
    } catch (err) {
      console.error("Batch approve failed:", err);
    }
  };

  if (loading) {
    return (
      <div class="flex items-center justify-center h-full">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full animate-fade-in">
      <div class="flex items-center gap-2 p-3 border-b border-vsc-border">
        <h3 class="text-sm font-semibold text-vsc-fg">
          Pending Approvals ({approvals.length})
        </h3>
        <div class="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleBatchApprove}>
            Approve Low Risk
          </Button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-3">
        {approvals.length === 0 ? (
          <EmptyState
            icon="✅"
            title="No Pending Approvals"
            description="All agent changes have been reviewed. New changes will appear here."
          />
        ) : (
          approvals.map((a) => (
            <ApprovalCard key={a.id} approval={a} onAction={handleAction} />
          ))
        )}
      </div>
    </div>
  );
}
