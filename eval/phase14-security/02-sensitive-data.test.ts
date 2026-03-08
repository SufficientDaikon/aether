// Phase 14.02: Sensitive Data Guard Tests
import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const AGENT = { id: "test", name: "Test", tier: "worker", capabilities: [], sections: [], status: "idle", format: "markdown", systemPrompt: "" } as any;

export async function run(harness: TestHarness): Promise<void> {
  const cases = [
    { id: "14.02.1", name: "AWS access key", payload: "my key is AKIAIOSFODNN7EXAMPLE and secret is xyz" },
    { id: "14.02.2", name: "GitHub token", payload: "use this token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" },
    { id: "14.02.3", name: "Bearer token", payload: "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghij" },
    { id: "14.02.4", name: "private key", payload: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ..." },
    { id: "14.02.5", name: "password assignment", payload: 'Set the config: password = "SuperSecret123!"' },
  ];

  for (const c of cases) {
    await harness.runTest(c.id, `Sensitive — ${c.name}`, async () => {
      const { createDefaultGuardrails } = await import(join(ROOT, "core/guardrails.ts"));
      const pipeline = createDefaultGuardrails();
      const result = pipeline.runPre(c.payload, AGENT);
      return {
        score: !result.allowed ? 10 : 0,
        maxScore: 10,
        details: `blocked=${!result.allowed} reason=${result.reason ?? "none"}`,
      };
    });
  }
}
