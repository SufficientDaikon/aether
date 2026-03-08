// Custom hooks for AETHER bridge communication

import { useEffect, useCallback } from "preact/hooks";
import { rpcCall, onEvent } from "../lib/message-bus";
import {
  useDashboardStore,
  useSystemStore,
  useAgentsStore,
  useTasksStore,
  useChatStore,
} from "../stores";
import type { Agent, Task, SystemStatus, ChatMessage } from "../lib/types";

// Poll system status every 5 seconds
export function useSystemPolling() {
  const updateStatus = useSystemStore((s) => s.updateStatus);
  const setConnected = useDashboardStore((s) => s.setConnected);
  const setLoading = useDashboardStore((s) => s.setLoading);
  const setError = useDashboardStore((s) => s.setError);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await rpcCall<SystemStatus>("getSystemStatus");
      if (status) {
        updateStatus(status);
        setConnected(true);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection lost");
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [updateStatus, setConnected, setLoading, setError]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);
}

// Fetch agents and subscribe to status changes
export function useAgents() {
  const setAgents = useAgentsStore((s) => s.setAgents);
  const updateAgent = useAgentsStore((s) => s.updateAgent);

  useEffect(() => {
    rpcCall<Agent[]>("getAgents", { includeOffline: true })
      .then((agents) => agents && setAgents(agents))
      .catch(() => {});

    return onEvent("agent_status_changed", (data) => {
      updateAgent(data.agentId, { status: data.status });
    });
  }, [setAgents, updateAgent]);
}

// Fetch tasks and subscribe to updates
export function useTasks() {
  const setTasks = useTasksStore((s) => s.setTasks);
  const updateTask = useTasksStore((s) => s.updateTask);

  useEffect(() => {
    rpcCall<Task[]>("getTasks")
      .then((tasks) => tasks && setTasks(tasks))
      .catch(() => {});

    const unsub1 = onEvent("task_updated", (data) => {
      updateTask(data.taskId, data.updates);
    });
    const unsub2 = onEvent("task_created", (data: Task) => {
      useTasksStore
        .getState()
        .setTasks([...Object.values(useTasksStore.getState().tasks), data]);
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [setTasks, updateTask]);
}

// Submit a task
export function useSubmitTask() {
  return useCallback(
    async (
      description: string,
      targetAgent?: string,
      priority: string = "P2",
    ) => {
      return rpcCall("submitTask", { description, targetAgent, priority });
    },
    [],
  );
}

// Send chat message
export function useSendChat() {
  const addMessage = useChatStore((s) => s.addMessage);
  const setLoading = useChatStore((s) => s.setLoading);

  return useCallback(
    async (message: string, command?: string) => {
      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
        command,
      };
      addMessage(userMsg);
      setLoading(true);

      try {
        const response = await rpcCall<ChatMessage>("sendChatMessage", {
          message,
          command,
        });
        if (response) addMessage(response);
      } catch (err) {
        addMessage({
          id: `err_${Date.now()}`,
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          timestamp: new Date().toISOString(),
        });
      } finally {
        setLoading(false);
      }
    },
    [addMessage, setLoading],
  );
}
