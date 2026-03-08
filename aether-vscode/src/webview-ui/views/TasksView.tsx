/** @jsxImportSource preact */
import { h } from "preact";
import { useState, useMemo } from "preact/hooks";
import { useTasksStore } from "../stores";
import {
  Card,
  Badge,
  Button,
  Input,
  Textarea,
  Select,
  Modal,
  Progress,
  EmptyState,
  Spinner,
} from "../components/ui";
import { useSubmitTask } from "../hooks/useAether";
import { rpcCall } from "../lib/message-bus";
import type { Task } from "../lib/types";
import { formatRelativeTime, formatDuration } from "../lib/formatters";

const statusConfig: Record<
  string,
  { icon: string; badge: "success" | "warning" | "error" | "info" | "default" }
> = {
  queued: { icon: "⏳", badge: "default" },
  running: { icon: "🔄", badge: "info" },
  completed: { icon: "✅", badge: "success" },
  failed: { icon: "❌", badge: "error" },
  cancelled: { icon: "🚫", badge: "warning" },
};

function TaskItem({ task, level = 0 }: { task: Task; level?: number }) {
  const { expandedTasks, toggleExpanded, tasks } = useTasksStore();
  const expanded = expandedTasks.has(task.id);
  const config = statusConfig[task.status] || statusConfig.queued;
  const subtasks = task.subtasks.map((id) => tasks[id]).filter(Boolean);

  return (
    <div style={{ paddingLeft: `${level * 20}px` }}>
      <div
        class="flex items-center gap-2 p-2 rounded hover:bg-vsc-list-hover cursor-pointer transition-colors"
        onClick={() => subtasks.length > 0 && toggleExpanded(task.id)}
      >
        {subtasks.length > 0 ? (
          <span class="text-xs text-vsc-desc w-4">{expanded ? "▼" : "▶"}</span>
        ) : (
          <span class="w-4" />
        )}
        <span class="text-sm">{config.icon}</span>
        <div class="flex-1 min-w-0">
          <p class="text-xs text-vsc-fg truncate">{task.description}</p>
          <div class="flex items-center gap-2 mt-0.5">
            <Badge variant={config.badge} size="sm">
              {task.status}
            </Badge>
            <span class="text-[10px] text-vsc-desc">{task.assignedAgent}</span>
            <span class="text-[10px] text-vsc-desc">
              {formatRelativeTime(task.created)}
            </span>
          </div>
        </div>
        {task.status === "running" && (
          <div class="w-16">
            <Progress value={task.progress} showLabel />
          </div>
        )}
        <div class="flex gap-1">
          {task.status === "running" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e: Event) => {
                e.stopPropagation();
                rpcCall("cancelTask", { taskId: task.id });
              }}
            >
              ⏹
            </Button>
          )}
          {task.status === "failed" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e: Event) => {
                e.stopPropagation();
                rpcCall("retryTask", { taskId: task.id });
              }}
            >
              🔄
            </Button>
          )}
        </div>
      </div>
      {expanded &&
        subtasks.map((st) => (
          <TaskItem key={st.id} task={st} level={level + 1} />
        ))}
    </div>
  );
}

export function TasksView() {
  const tasks = useTasksStore((s) => s.tasks);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [desc, setDesc] = useState("");
  const [targetAgent, setTargetAgent] = useState("");
  const [priority, setPriority] = useState("P2");
  const submitTask = useSubmitTask();
  const [submitting, setSubmitting] = useState(false);

  const taskList = useMemo(() => {
    let list = Object.values(tasks).filter((t) => !t.parentTask);
    if (filter !== "all") list = list.filter((t) => t.status === filter);
    return list.sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
    );
  }, [tasks, filter]);

  const handleSubmit = async () => {
    if (!desc.trim()) return;
    setSubmitting(true);
    try {
      await submitTask(desc, targetAgent || undefined, priority);
      setDesc("");
      setTargetAgent("");
      setPriority("P2");
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="flex flex-col h-full animate-fade-in">
      {/* Toolbar */}
      <div class="flex items-center gap-2 p-3 border-b border-vsc-border">
        <Button onClick={() => setShowForm(true)}>📝 New Task</Button>
        <Button
          variant="ghost"
          onClick={() =>
            rpcCall("getTasks").then(
              (t: any) => t && useTasksStore.getState().setTasks(t),
            )
          }
        >
          🔄
        </Button>
        <Select
          value={filter}
          onChange={setFilter}
          options={[
            { label: "All Tasks", value: "all" },
            { label: "Running", value: "running" },
            { label: "Queued", value: "queued" },
            { label: "Completed", value: "completed" },
            { label: "Failed", value: "failed" },
          ]}
        />
        <span class="text-[11px] text-vsc-desc ml-auto">
          {taskList.length} tasks
        </span>
      </div>

      {/* Task List */}
      <div class="flex-1 overflow-y-auto p-2">
        {taskList.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No Tasks"
            description="Submit a task to get started with AETHER agent orchestration."
            action={
              <Button onClick={() => setShowForm(true)}>Create Task</Button>
            }
          />
        ) : (
          taskList.map((task) => <TaskItem key={task.id} task={task} />)
        )}
      </div>

      {/* New Task Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Submit New Task"
        size="md"
      >
        <div class="space-y-3">
          <div>
            <label class="text-xs text-vsc-desc block mb-1">Description</label>
            <Textarea
              placeholder="Describe what you want to accomplish..."
              value={desc}
              onChange={setDesc}
              rows={4}
            />
          </div>
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="text-xs text-vsc-desc block mb-1">
                Target Agent (optional)
              </label>
              <Input
                placeholder="e.g. code-reviewer"
                value={targetAgent}
                onChange={setTargetAgent}
              />
            </div>
            <div>
              <label class="text-xs text-vsc-desc block mb-1">Priority</label>
              <Select
                value={priority}
                onChange={setPriority}
                options={[
                  { label: "P1 - Critical", value: "P1" },
                  { label: "P2 - Normal", value: "P2" },
                  { label: "P3 - Low", value: "P3" },
                ]}
              />
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              loading={submitting}
              disabled={!desc.trim()}
            >
              Submit Task
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
