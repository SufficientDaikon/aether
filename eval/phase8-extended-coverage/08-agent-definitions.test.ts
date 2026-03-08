// ─────────────────────────────────────────────────────────────
// Phase 8.08: Agent Definition Validation
// ─────────────────────────────────────────────────────────────

import type { TestHarness } from "../helpers/test-harness.ts";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";

const ROOT = join(import.meta.dir, "../..");
const AGENTS_DIR = join(ROOT, "agents");

function findAgentFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...findAgentFiles(p));
      else if (entry.name.endsWith(".agent.md")) files.push(p);
    }
  } catch {}
  return files;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const result: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    result[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return result;
}

export async function run(harness: TestHarness): Promise<void> {
  const files = findAgentFiles(AGENTS_DIR);

  await harness.runTest("8.08.1", "Agent defs — 34 files found", async () => ({
    score: files.length >= 34 ? 10 : Math.floor((files.length / 34) * 10),
    maxScore: 10,
    details: `Found ${files.length} agent files`,
  }));

  await harness.runTest(
    "8.08.2",
    "Agent defs — required frontmatter",
    async () => {
      const required = ["id", "name", "tier"];
      let valid = 0;
      const errs: string[] = [];
      for (const f of files) {
        const fm = parseFrontmatter(readFileSync(f, "utf-8"));
        if (!fm) {
          errs.push(`${f.split(/[\\/]/).pop()}: no frontmatter`);
          continue;
        }
        const missing = required.filter((k) => !fm[k]);
        if (missing.length === 0) valid++;
        else errs.push(`${f.split(/[\\/]/).pop()}: missing [${missing}]`);
      }
      return {
        score: files.length ? Math.round((valid / files.length) * 10) : 0,
        maxScore: 10,
        details: `${valid}/${files.length} valid. ${errs.slice(0, 3).join("; ")}`,
      };
    },
  );

  await harness.runTest(
    "8.08.3",
    "Agent defs — valid tier values",
    async () => {
      const tiers = [
        "master",
        "manager",
        "worker",
        "infrastructure",
        "external",
        "meta",
        "forge",
        "sentinel",
      ];
      let valid = 0;
      for (const f of files) {
        const fm = parseFrontmatter(readFileSync(f, "utf-8"));
        if (fm?.tier && tiers.includes(fm.tier.toLowerCase())) valid++;
      }
      return {
        score: files.length ? Math.round((valid / files.length) * 10) : 0,
        maxScore: 10,
        details: `${valid}/${files.length} have valid tiers`,
      };
    },
  );

  await harness.runTest("8.08.4", "Agent defs — unique IDs", async () => {
    const ids = new Map<string, string>();
    const dupes: string[] = [];
    for (const f of files) {
      const fm = parseFrontmatter(readFileSync(f, "utf-8"));
      if (!fm?.id) continue;
      if (ids.has(fm.id)) dupes.push(fm.id);
      else ids.set(fm.id, f.split(/[\\/]/).pop()!);
    }
    return {
      score: dupes.length === 0 ? 10 : Math.max(0, 10 - dupes.length * 3),
      maxScore: 10,
      details:
        dupes.length === 0
          ? `All ${ids.size} IDs unique`
          : `Dupes: ${dupes.join(", ")}`,
    };
  });
}
