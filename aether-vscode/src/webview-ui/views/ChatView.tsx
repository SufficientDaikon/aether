/** @jsxImportSource preact */
import { h } from "preact";
import { useRef, useEffect, useMemo, useState } from "preact/hooks";
import { useChatStore } from "../stores";
import { useSendChat } from "../hooks/useAether";
import { Button, Spinner, Badge } from "../components/ui";
import { rpcCall } from "../lib/message-bus";
import type { ChatMessage } from "../lib/types";
import { formatRelativeTime } from "../lib/formatters";
import MarkdownIt from "markdown-it";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string) {
    const grammar = lang && Prism.languages[lang];
    if (grammar) {
      const highlighted = Prism.highlight(str, grammar, lang);
      return `<pre class="prism-code bg-vsc-sidebar-bg border border-vsc-border rounded p-2 my-2 overflow-x-auto text-xs font-vsc-editor"><code class="language-${lang}">${highlighted}</code></pre>`;
    }
    return `<pre class="prism-code bg-vsc-sidebar-bg border border-vsc-border rounded p-2 my-2 overflow-x-auto text-xs font-vsc-editor"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

const SLASH_COMMANDS = [
  { cmd: "/run", desc: "Execute task on best-fit agent" },
  { cmd: "/plan", desc: "Decompose task into sub-tasks" },
  { cmd: "/review", desc: "Code review with security analysis" },
  { cmd: "/test", desc: "Generate and run tests" },
  { cmd: "/debug", desc: "Investigate and fix errors" },
  { cmd: "/architect", desc: "System design and architecture" },
  { cmd: "/group", desc: "Multi-agent group discussion" },
  { cmd: "/status", desc: "Show tasks, costs, agent states" },
  { cmd: "/context", desc: "Switch agent namespace/context" },
];

function renderMarkdown(content: string): string {
  return md.render(content);
}

function ChatMessageComponent({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      class={`flex gap-2 p-3 ${isUser ? "" : "bg-vsc-sidebar-bg/50"} animate-fade-in`}
    >
      <div
        class={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
          isUser
            ? "bg-vsc-btn-bg text-vsc-btn-fg"
            : "bg-emerald-600/20 text-emerald-400"
        }`}
      >
        {isUser ? "U" : "A"}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs font-semibold text-vsc-fg">
            {isUser ? "You" : message.agent || "AETHER"}
          </span>
          {message.command && (
            <Badge variant="info" size="sm">
              {message.command}
            </Badge>
          )}
          <span class="text-[10px] text-vsc-desc">
            {formatRelativeTime(message.timestamp)}
          </span>
        </div>
        <div
          class="text-xs text-vsc-fg leading-relaxed markdown-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
        />
        {message.codeBlocks?.map((block) => (
          <div key={block.id} class="mt-2">
            <div class="flex items-center justify-between bg-vsc-sidebar-bg border border-vsc-border rounded-t px-2 py-1">
              <span class="text-[10px] text-vsc-desc">
                {block.filename || block.language}
              </span>
              <Button
                variant={block.applied ? "ghost" : "primary"}
                size="sm"
                disabled={block.applied}
                onClick={() =>
                  rpcCall("applyCodeBlock", {
                    blockId: block.id,
                    filename: block.filename,
                  })
                }
              >
                {block.applied ? "✓ Applied" : "Apply"}
              </Button>
            </div>
            <pre class="bg-vsc-sidebar-bg border border-t-0 border-vsc-border rounded-b p-2 overflow-x-auto text-xs font-vsc-editor">
              <code>{block.code}</code>
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const inputValue = useChatStore((s) => s.inputValue);
  const setInput = useChatStore((s) => s.setInput);
  const loading = useChatStore((s) => s.loading);
  const sendChat = useSendChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showCommands, setShowCommands] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const value = inputValue.trim();
    if (!value || loading) return;

    // Parse slash command
    let command: string | undefined;
    let message = value;
    const cmdMatch = value.match(/^\/(\w+)\s*(.*)/);
    if (cmdMatch) {
      command = cmdMatch[1];
      message = cmdMatch[2] || command;
    }

    sendChat(message, command);
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div class="flex flex-col h-full animate-fade-in">
      {/* Messages */}
      <div class="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div class="flex flex-col items-center justify-center h-full text-center p-8">
            <span class="text-4xl mb-4">💬</span>
            <h2 class="text-sm font-semibold text-vsc-fg">AETHER Chat</h2>
            <p class="text-xs text-vsc-desc mt-2 max-w-sm">
              Chat with AETHER's multi-agent system. Use slash commands like
              /run, /plan, /review for specialized operations.
            </p>
            <div class="flex flex-wrap gap-1 mt-4 max-w-md justify-center">
              {SLASH_COMMANDS.map(({ cmd, desc }) => (
                <button
                  key={cmd}
                  class="px-2 py-1 text-[11px] bg-vsc-sidebar-bg border border-vsc-border rounded hover:border-vsc-focus transition-colors"
                  onClick={() => setInput(cmd + " ")}
                >
                  <span class="text-vsc-link">{cmd}</span>
                  <span class="text-vsc-desc ml-1">{desc}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessageComponent key={msg.id} message={msg} />
            ))}
            {loading && (
              <div class="flex gap-2 p-3 items-center">
                <Spinner size={14} />
                <span class="text-xs text-vsc-desc">Thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div class="border-t border-vsc-border p-3">
        <div class="flex gap-2">
          <div class="flex-1 relative">
            <textarea
              class="w-full px-3 py-2 bg-vsc-input-bg text-vsc-input-fg border border-vsc-input-border rounded text-xs font-vsc resize-none focus:outline-none focus:ring-1 focus:ring-vsc-focus"
              placeholder="Type a message or /command..."
              value={inputValue}
              onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown as any}
              rows={2}
              disabled={loading}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || loading}
            className="self-end"
          >
            ⏎
          </Button>
        </div>
        <div class="flex gap-1 mt-1.5">
          {SLASH_COMMANDS.slice(0, 5).map(({ cmd }) => (
            <button
              key={cmd}
              class="px-1.5 py-0.5 text-[10px] text-vsc-desc hover:text-vsc-fg bg-vsc-sidebar-bg rounded transition-colors"
              onClick={() => setInput(cmd + " ")}
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
