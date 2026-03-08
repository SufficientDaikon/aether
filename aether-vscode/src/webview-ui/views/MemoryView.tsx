/** @jsxImportSource preact */
import { h } from "preact";
import { useState } from "preact/hooks";
import {
  Card,
  Badge,
  Button,
  Input,
  Select,
  EmptyState,
  Spinner,
} from "../components/ui";
import { rpcCall } from "../lib/message-bus";
import type { MemoryResult } from "../lib/types";
import { formatRelativeTime } from "../lib/formatters";

const typeIcons: Record<string, string> = {
  conversation: "💬",
  code: "📝",
  embedding: "🧠",
  cache: "📦",
};

function MemoryResultCard({ result }: { result: MemoryResult }) {
  return (
    <Card className="animate-fade-in">
      <div class="flex items-start gap-2">
        <span class="text-lg">{typeIcons[result.type] || "📄"}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <Badge variant="info" size="sm">
              {result.type}
            </Badge>
            <span class="text-[10px] text-vsc-desc">
              Score: {result.score.toFixed(2)}
            </span>
            {result.agent && (
              <span class="text-[10px] text-vsc-desc">
                Agent: {result.agent}
              </span>
            )}
            <span class="text-[10px] text-vsc-desc">
              {formatRelativeTime(result.timestamp)}
            </span>
          </div>
          <p class="text-xs text-vsc-fg leading-relaxed whitespace-pre-wrap">
            {result.content.length > 300
              ? result.content.slice(0, 300) + "..."
              : result.content}
          </p>
          <p class="text-[10px] text-vsc-desc mt-1">Source: {result.source}</p>
        </div>
      </div>
    </Card>
  );
}

export function MemoryView() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [results, setResults] = useState<MemoryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const params: any = { query: query.trim(), limit: 20 };
      if (typeFilter !== "all") params.type = typeFilter;
      const data = await rpcCall<MemoryResult[]>("searchMemory", params);
      setResults(data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex flex-col h-full animate-fade-in">
      {/* Search Bar */}
      <div class="p-3 border-b border-vsc-border space-y-2">
        <div class="flex gap-2">
          <div class="flex-1">
            <Input
              placeholder="Search agent memory..."
              value={query}
              onChange={setQuery}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch} loading={loading}>
            🔍 Search
          </Button>
        </div>
        <div class="flex gap-2">
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { label: "All Types", value: "all" },
              { label: "💬 Conversations", value: "conversation" },
              { label: "📝 Code", value: "code" },
              { label: "🧠 Embeddings", value: "embedding" },
              { label: "📦 Cache", value: "cache" },
            ]}
          />
          {searched && (
            <span class="text-[11px] text-vsc-desc self-center">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      <div class="flex-1 overflow-y-auto p-3 space-y-2">
        {!searched ? (
          <EmptyState
            icon="🧠"
            title="Search AETHER Memory"
            description="Search across conversations, code embeddings, learned patterns, and cached results."
          />
        ) : loading ? (
          <div class="flex items-center justify-center py-12">
            <Spinner size={24} />
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No Results"
            description={`No memory entries found for "${query}". Try a different search term.`}
          />
        ) : (
          results.map((r) => <MemoryResultCard key={r.id} result={r} />)
        )}
      </div>
    </div>
  );
}
