/** @jsxImportSource preact */
import { h } from "preact";
import { render } from "preact";
import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import { initMessageBus, signalReady, onEvent, rpcCall } from "./lib/message-bus";
import {
  useDashboardStore,
  useChatStore,
  useAgentsStore,
  useTasksStore,
  useSidebarStore,
} from "./stores";
import { useSystemPolling, useAgents, useTasks, useSendChat } from "./hooks/useAether";
import { AgentsView } from "./views/AgentsView";
import { TasksView } from "./views/TasksView";
import { ApprovalsView } from "./views/ApprovalsView";
import { MemoryView } from "./views/MemoryView";
import { SettingsView } from "./views/SettingsView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { ChatMessage } from "./lib/types";
import { formatRelativeTime } from "./lib/formatters";
import MarkdownIt from "markdown-it";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "./index.css";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string) {
    const grammar = lang && Prism.languages[lang];
    if (grammar) {
      return `<pre class="code-block"><code class="language-${lang}">${Prism.highlight(str, grammar, lang)}</code></pre>`;
    }
    return `<pre class="code-block"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

const SLASH_COMMANDS = [
  { cmd: "/run", desc: "Execute on best-fit agent", icon: "▶" },
  { cmd: "/plan", desc: "Decompose into sub-tasks", icon: "📋" },
  { cmd: "/review", desc: "Code review + security", icon: "🔍" },
  { cmd: "/test", desc: "Generate + run tests", icon: "🧪" },
  { cmd: "/debug", desc: "Investigate errors", icon: "🐛" },
  { cmd: "/architect", desc: "System design", icon: "🏗" },
  { cmd: "/group", desc: "Multi-agent discussion", icon: "👥" },
  { cmd: "/status", desc: "System status", icon: "📊" },
  { cmd: "/context", desc: "Switch namespace", icon: "🔄" },
];

const BOTTOM_PANELS = [
  { id: "tasks", label: "Tasks", icon: "📋" },
  { id: "agents", label: "Agents", icon: "🤖" },
  { id: "approvals", label: "Approvals", icon: "✅" },
  { id: "memory", label: "Memory", icon: "🧠" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

// ── Message Bubble ──────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div class={`chat-message ${isUser ? "chat-user" : "chat-assistant"}`}>
      {!isUser && (
        <div class="chat-agent-label">
          <span class="agent-dot" />
          <span>{message.agent || "AETHER"}</span>
          {message.command && (
            <span class="chat-cmd-badge">/{message.command}</span>
          )}
          <span class="chat-time">{formatRelativeTime(message.timestamp)}</span>
        </div>
      )}
      <div class={`chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-assistant"}`}>
        {isUser ? (
          <span class="chat-text">{message.content}</span>
        ) : (
          <div
            class="markdown-body chat-text"
            dangerouslySetInnerHTML={{ __html: md.render(message.content) }}
          />
        )}
        {message.codeBlocks?.map((block) => (
          <div class="code-block-wrapper" key={block.id}>
            <div class="code-block-header">
              <span class="code-lang">{block.filename || block.language}</span>
              <button
                class={`code-apply-btn ${block.applied ? "applied" : ""}`}
                disabled={block.applied}
                onClick={() =>
                  rpcCall("applyCodeBlock", {
                    blockId: block.id,
                    filename: block.filename,
                  })
                }
              >
                {block.applied ? "✓ Applied" : "Apply"}
              </button>
            </div>
            <pre class="code-block">
              <code>{block.code}</code>
            </pre>
          </div>
        ))}
      </div>
      {isUser && (
        <div class="chat-time-user">{formatRelativeTime(message.timestamp)}</div>
      )}
    </div>
  );
}

// ── Agent Selector ──────────────────────────────────────────

function AgentSelector() {
  const [open, setOpen] = useState(false);
  const agents = useAgentsStore((s) => s.agents);
  const selectedAgentId = useSidebarStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useSidebarStore((s) => s.setSelectedAgentId);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const agentList = Object.values(agents);
  const currentAgent = agents[selectedAgentId];
  const tierIcon: Record<string, string> = { master: "👑", manager: "📊", worker: "⚡" };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div class="agent-selector-wrapper" ref={dropdownRef}>
      <button
        class={`agent-selector-btn ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        title="Select active agent"
      >
        <span class="agent-selector-dot" />
        <span class="agent-selector-name">{selectedAgentId}</span>
        {currentAgent && (
          <span class="agent-selector-tier">{currentAgent.tier}</span>
        )}
        <span class="agent-selector-chevron">▾</span>
      </button>
      {open && (
        <div class="agent-dropdown">
          <div class="agent-dropdown-header">Select Agent</div>
          {agentList.length === 0 ? (
            <div class="agent-dropdown-empty">No agents connected</div>
          ) : (
            agentList.map((agent) => (
              <button
                key={agent.id}
                class={`agent-dropdown-item ${agent.id === selectedAgentId ? "active" : ""}`}
                onClick={() => {
                  setSelectedAgentId(agent.id);
                  setOpen(false);
                }}
              >
                <span class="agent-dropdown-icon">
                  {tierIcon[agent.tier] || "⚡"}
                </span>
                <div class="agent-dropdown-info">
                  <span class="agent-dropdown-name">{agent.name || agent.id}</span>
                  <span class="agent-dropdown-cap">
                    {agent.capabilities.slice(0, 2).join(", ")}
                  </span>
                </div>
                <span class={`agent-status-dot status-${agent.status}`} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────

function WelcomeScreen({ onCommand }: { onCommand: (cmd: string) => void }) {
  return (
    <div class="welcome-screen">
      <div class="welcome-logo">
        <span class="welcome-bolt">⚡</span>
        <h1 class="welcome-title">AETHER</h1>
        <p class="welcome-subtitle">Multi-Agent Orchestrator</p>
      </div>
      <p class="welcome-desc">
        33 specialized AI agents. Use slash commands for targeted operations.
      </p>
      <div class="welcome-commands">
        {SLASH_COMMANDS.slice(0, 6).map(({ cmd, desc, icon }) => (
          <button
            key={cmd}
            class="welcome-cmd-chip"
            onClick={() => onCommand(cmd + " ")}
          >
            <span class="welcome-cmd-icon">{icon}</span>
            <span class="welcome-cmd-name">{cmd}</span>
            <span class="welcome-cmd-desc">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Chat Thread ─────────────────────────────────────────────

function ChatThread({ onSetInput }: { onSetInput: (v: string) => void }) {
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  if (messages.length === 0) {
    return (
      <div class="chat-empty">
        <WelcomeScreen onCommand={onSetInput} />
      </div>
    );
  }

  return (
    <div class="chat-thread" aria-live="polite">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {loading && (
        <div class="chat-thinking">
          <span class="thinking-dots">
            <span />
            <span />
            <span />
          </span>
          <span class="thinking-label">AETHER is thinking…</span>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

// ── Bottom Panel ────────────────────────────────────────────

function BottomPanel() {
  const activePanel = useSidebarStore((s) => s.activePanel);
  const setActivePanel = useSidebarStore((s) => s.setActivePanel);
  const tasks = useTasksStore((s) => s.tasks);

  const activeTasks = Object.values(tasks).filter(
    (t) => t.status === "running" || t.status === "queued",
  );
  const panelBadges: Record<string, number> = { tasks: activeTasks.length };

  return (
    <div class="bottom-panel" role="complementary">
      <div class="panel-tabs" role="tablist">
        {BOTTOM_PANELS.map(({ id, label, icon }) => {
          const badge = panelBadges[id] || 0;
          return (
            <button
              key={id}
              class={`panel-tab ${activePanel === id ? "active" : ""}`}
              onClick={() => setActivePanel(activePanel === id ? null : id)}
              title={label}
              role="tab"
              aria-selected={activePanel === id}
            >
              <span>{icon}</span>
              <span class="panel-tab-label">{label}</span>
              {badge > 0 && <span class="panel-tab-badge">{badge}</span>}
            </button>
          );
        })}
      </div>
      {activePanel && (
        <div class="panel-content" role="tabpanel">
          {activePanel === "tasks" && <TasksView />}
          {activePanel === "agents" && <AgentsView />}
          {activePanel === "approvals" && <ApprovalsView />}
          {activePanel === "memory" && <MemoryView />}
          {activePanel === "settings" && <SettingsView />}
        </div>
      )}
    </div>
  );
}

// ── Slash Suggestions ───────────────────────────────────────

function SlashSuggestions({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (cmd: string) => void;
}) {
  const filtered = SLASH_COMMANDS.filter(
    (c) =>
      c.cmd.includes(query) ||
      c.desc.toLowerCase().includes(query.toLowerCase()),
  );
  if (filtered.length === 0) return null;
  return (
    <div class="slash-suggestions">
      {filtered.map(({ cmd, desc, icon }) => (
        <button
          key={cmd}
          class="slash-suggestion-item"
          onClick={() => onSelect(cmd + " ")}
        >
          <span class="slash-icon">{icon}</span>
          <span class="slash-cmd">{cmd}</span>
          <span class="slash-desc">{desc}</span>
        </button>
      ))}
    </div>
  );
}

// ── Chat Input ──────────────────────────────────────────────

function ChatInput() {
  const inputValue = useChatStore((s) => s.inputValue);
  const setInput = useChatStore((s) => s.setInput);
  const loading = useChatStore((s) => s.loading);
  const sendChat = useSendChat();
  const [showSlash, setShowSlash] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = (value: string) => {
    setInput(value);
    if (value.startsWith("/") && !value.includes(" ")) {
      setShowSlash(true);
      setSlashQuery(value.slice(1));
    } else {
      setShowSlash(false);
    }
  };

  const handleSend = useCallback(() => {
    const value = inputValue.trim();
    if (!value || loading) return;
    let command: string | undefined;
    let message = value;
    const cmdMatch = value.match(/^\/(\w+)\s*(.*)/s);
    if (cmdMatch) {
      command = cmdMatch[1];
      message = cmdMatch[2] || command;
    }
    sendChat(message, command);
    setInput("");
    setShowSlash(false);
  }, [inputValue, loading, sendChat, setInput]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      setShowSlash(false);
    }
  };

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [inputValue]);

  return (
    <div class="chat-input-wrapper">
      {showSlash && (
        <SlashSuggestions
          query={slashQuery}
          onSelect={(cmd) => {
            setInput(cmd);
            setShowSlash(false);
            textareaRef.current?.focus();
          }}
        />
      )}
      <div class="chat-input-row">
        <textarea
          ref={textareaRef}
          class="chat-textarea"
          placeholder="Ask AETHER… (/ for commands)"
          aria-label="Chat message input"
          value={inputValue}
          onInput={(e) => handleInput((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown as any}
          disabled={loading}
          rows={1}
        />
        <button
          class={`chat-send-btn ${inputValue.trim() && !loading ? "ready" : ""}`}
          onClick={handleSend}
          disabled={!inputValue.trim() || loading}
          title="Send (Enter)"
        >
          {loading ? <span class="send-spinner" /> : <span>↑</span>}
        </button>
      </div>
      <div class="chat-hints">
        {SLASH_COMMANDS.slice(0, 4).map(({ cmd }) => (
          <button
            key={cmd}
            class="chat-hint-chip"
            onClick={() => {
              setInput(cmd + " ");
              textareaRef.current?.focus();
            }}
          >
            {cmd}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── App Header ──────────────────────────────────────────────

function AppHeader() {
  const connected = useDashboardStore((s) => s.connected);
  const [reconnecting, setReconnecting] = useState(false);

  const openDashboard = () => {
    rpcCall("openDashboard", {}).catch(() => {});
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await rpcCall("reconnect", {});
    } catch {
      // If reconnect RPC itself fails (bridge truly dead), try the VS Code command
      rpcCall("openDashboard", {}).catch(() => {});
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div class="app-header">
      <div class="header-brand">
        <span class="header-bolt">⚡</span>
        <span class="header-title">AETHER</span>
      </div>
      <AgentSelector />
      <div class="header-actions">
        {!connected && (
          <button
            class={`reconnect-btn ${reconnecting ? "spinning" : ""}`}
            onClick={handleReconnect}
            title="Reconnect to AETHER runtime"
            disabled={reconnecting}
          >
            {reconnecting ? "⟳" : "↻"}
          </button>
        )}
        <span
          class={`connection-dot ${connected ? "connected" : "disconnected"}`}
          title={connected ? "Connected to AETHER runtime" : "Disconnected — click ↻ to reconnect"}
        />
        <button
          class="header-expand-btn"
          onClick={openDashboard}
          title="Open full dashboard"
        >
          ⊞
        </button>
      </div>
    </div>
  );
}

// ── Root App ────────────────────────────────────────────────

function App() {
  const setInput = useChatStore((s) => s.setInput);
  const setActivePanel = useSidebarStore((s) => s.setActivePanel);

  useSystemPolling();
  useAgents();
  useTasks();

  onEvent("navigate", (panel: string) => {
    setActivePanel(panel);
  });

  return (
    <div class="app-root" role="main">
      <AppHeader />
      <ErrorBoundary fallbackLabel="Chat area">
        <div class="chat-area">
          <ChatThread onSetInput={setInput} />
        </div>
      </ErrorBoundary>
      <ErrorBoundary fallbackLabel="Bottom panel">
        <BottomPanel />
      </ErrorBoundary>
      <ChatInput />
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
