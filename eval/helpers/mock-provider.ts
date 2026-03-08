// ─────────────────────────────────────────────────────────────
// AETHER Eval — Mock Provider
// Deterministic mock LLM for non-API test phases
// ─────────────────────────────────────────────────────────────

import {
  BaseLLMProvider,
  type LLMOptions,
  type LLMResponse,
} from "../../providers/base.ts";
import { ProviderManager } from "../../providers/manager.ts";

const CANNED_RESPONSES: Array<{ pattern: RegExp; response: string }> = [
  { pattern: /what is 2\+2/i, response: "The answer is 4." },
  {
    pattern: /react.*component/i,
    response:
      '```tsx\nimport { useState } from "react";\n\nexport function Counter() {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(c => c + 1)}>+</button>\n    </div>\n  );\n}\n```',
  },
  {
    pattern: /sql|schema|database|postgres/i,
    response:
      "```sql\nCREATE TABLE posts (\n  id SERIAL PRIMARY KEY,\n  title VARCHAR(255) NOT NULL,\n  content TEXT,\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);\n```",
  },
  {
    pattern: /security|vulnerab|audit/i,
    response:
      "Security analysis complete. No critical vulnerabilities found. Minor: ensure HTTPS redirect, add CSP headers.",
  },
  {
    pattern: /test|qa|quality/i,
    response:
      "Test plan generated:\n1. Unit tests for core logic\n2. Integration tests for API endpoints\n3. E2E tests for user flows",
  },
  {
    pattern: /architect|design|plan/i,
    response:
      "Architecture plan:\n1. Frontend: React + TypeScript\n2. Backend: Bun HTTP server\n3. Database: SQLite\n4. Deployment: Docker container",
  },
  {
    pattern: /review|ux|accessibility/i,
    response:
      "UX Review Score: 87/100.\nStrengths: Clean layout, good contrast.\nImprovements: Add keyboard navigation, improve mobile responsiveness.",
  },
  {
    pattern: /.*/,
    response:
      "Task completed successfully. Mock response generated for testing purposes.",
  },
];

export class MockProvider extends BaseLLMProvider {
  private callLog: Array<{
    prompt: string;
    options: LLMOptions;
    timestamp: number;
  }> = [];

  constructor() {
    super("mock", "mock-key-not-real");
  }

  async send(prompt: string, options: LLMOptions): Promise<LLMResponse> {
    const start = Date.now();
    this.callLog.push({ prompt, options, timestamp: start });

    const match = CANNED_RESPONSES.find((r) => r.pattern.test(prompt));
    const content = match?.response ?? "Mock response";

    // Simulate realistic latency (50-200ms)
    const delay = 50 + Math.random() * 150;
    await new Promise((r) => setTimeout(r, delay));

    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(content.length / 4);

    this.trackUsage(inputTokens, outputTokens);

    return {
      content,
      model: options.model ?? "mock",
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      latencyMs: Date.now() - start,
      provider: "mock",
    };
  }

  getCallLog() {
    return [...this.callLog];
  }

  resetCallLog() {
    this.callLog = [];
  }
}

/** Create a ProviderManager with mock sendForTier */
export function createMockProviderManager(): {
  providers: ProviderManager;
  mock: MockProvider;
} {
  const mock = new MockProvider();
  const providers = new ProviderManager({
    tiers: {
      master: { provider: "gemini", model: "gemini-2.5-pro" },
      manager: { provider: "gemini", model: "gemini-2.5-pro" },
      worker: { provider: "gemini", model: "gemini-2.5-flash" },
    },
    fallbackChain: [],
  });

  // Monkey-patch sendForTier and sendDirect to use mock
  (providers as any).sendForTier = async (
    _tier: string,
    prompt: string,
    opts?: Partial<LLMOptions>,
  ) => {
    return mock.send(prompt, { model: "mock", ...opts });
  };

  (providers as any).sendDirect = async (
    _provider: string,
    prompt: string,
    opts: LLMOptions,
  ) => {
    return mock.send(prompt, opts);
  };

  return { providers, mock };
}
