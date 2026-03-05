// ─────────────────────────────────────────────────────────────
// Synapse DSL — Transpiler
// Converts an AST into JSON agent configs, .agent.md files,
// workflow configs, pipeline configs, and BAP-01 messages.
// ─────────────────────────────────────────────────────────────

import type {
  ASTNode,
  AgentNode,
  WorkflowNode,
  PipelineNode,
} from "./parser.ts";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ───────────────── LLM & Format Mappings ─────────────────

/** Map Synapse LLM shorthand → runtime LLMModelTier */
const LLM_MAP: Record<string, string> = {
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
  "gpt4o": "gpt4o",
  "gpt4o-mini": "gpt4o-mini",
  "gemini-ultra": "gemini-ultra",
  "gemini-pro": "gemini-pro",
  "gemini-flash": "gemini-flash",
  local: "local",
};

/** Map Synapse format shorthand → runtime AgentFormat */
const FORMAT_MAP: Record<string, string> = {
  xml: "xml",
  markdown: "markdown",
  md: "markdown",
  json: "json",
};

// ───────────────── Transpiler ─────────────────

export class Transpiler {
  // ───────────── To JSON (generic) ─────────────

  /** Transpile all AST nodes to their JSON representations. */
  static toJSON(nodes: ASTNode[]): object[] {
    return nodes.map((node) => {
      switch (node.type) {
        case "agent":
          return Transpiler.agentToJSON(node);
        case "workflow":
          return Transpiler.workflowToJSON(node);
        case "pipeline":
          return Transpiler.pipelineToJSON(node);
      }
    });
  }

  // ───────────── Agent → JSON ─────────────

  /**
   * Convert an AgentNode to an AgentDefinition-compatible JSON object.
   * Output matches the shape expected by `AgentRegistry.register()`.
   */
  private static agentToJSON(node: AgentNode): object {
    const props = node.properties;

    const sections = Transpiler.toArray(props["sections"]).map((s) =>
      s.toUpperCase()
    );
    const capabilities = Transpiler.toArray(props["capabilities"]);
    const dependencies = Transpiler.toArray(props["dependencies"]);

    return {
      id: node.id,
      name: Transpiler.toString(props["name"]) || node.id,
      tier: Transpiler.toString(props["tier"]) || "worker",
      sections,
      capabilities,
      dependencies,
      llmRequirement: LLM_MAP[Transpiler.toString(props["llm"])] || "sonnet",
      format:
        FORMAT_MAP[Transpiler.toString(props["format"])] || "markdown",
      escalationTarget:
        Transpiler.toString(props["escalates-to"]) || null,
      filePath: `agents/${node.id}.agent.md`,
      status: "idle",
      metadata: {
        tools: node.tools || [],
        prompt: node.prompt || "",
        handlers: node.handlers.map((h) => ({
          condition: h.condition,
          actions: h.actions.map((a) => ({
            type: a.type,
            target: a.target,
            ...(a.args?.length ? { args: a.args } : {}),
          })),
        })),
      },
    };
  }

  // ───────────── Agent → Markdown ─────────────

  /**
   * Produce a `.agent.md` file with YAML frontmatter for LLM consumption.
   *
   * Format:
   * ```
   * ---
   * id: react-specialist
   * name: React & Framework Specialist
   * tier: worker
   * ...
   * ---
   * # React & Framework Specialist
   *
   * <system prompt text>
   *
   * ## Tools
   * - file-io
   * - terminal
   *
   * ## Event Handlers
   * ### when needs MCP_SERVER
   * - request mcp-server-creator
   * ```
   */
  static toAgentFile(node: AgentNode): string {
    const props = node.properties;
    const name = Transpiler.toString(props["name"]) || node.id;
    const tier = Transpiler.toString(props["tier"]) || "worker";
    const sections = Transpiler.toArray(props["sections"]).map((s) =>
      s.toUpperCase()
    );
    const capabilities = Transpiler.toArray(props["capabilities"]);
    const dependencies = Transpiler.toArray(props["dependencies"]);
    const llm = Transpiler.toString(props["llm"]) || "sonnet";
    const format = Transpiler.toString(props["format"]) || "markdown";
    const escalatesTo = Transpiler.toString(props["escalates-to"]);

    const lines: string[] = [];

    // YAML frontmatter
    lines.push("---");
    lines.push(`id: ${node.id}`);
    lines.push(`name: "${name}"`);
    lines.push(`tier: ${tier}`);
    lines.push(`sections: [${sections.join(", ")}]`);
    lines.push(`capabilities: [${capabilities.join(", ")}]`);
    lines.push(`dependencies: [${dependencies.join(", ")}]`);
    lines.push(`llm: ${llm}`);
    lines.push(`format: ${format}`);
    if (escalatesTo) {
      lines.push(`escalates-to: ${escalatesTo}`);
    }
    if (node.tools?.length) {
      lines.push(`tools: [${node.tools.join(", ")}]`);
    }
    lines.push("---");
    lines.push("");

    // Title
    lines.push(`# ${name}`);
    lines.push("");

    // System prompt
    if (node.prompt) {
      lines.push(node.prompt);
      lines.push("");
    }

    // Tools section
    if (node.tools?.length) {
      lines.push("## Tools");
      lines.push("");
      for (const tool of node.tools) {
        lines.push(`- ${tool}`);
      }
      lines.push("");
    }

    // Event handlers
    if (node.handlers.length) {
      lines.push("## Event Handlers");
      lines.push("");
      for (const handler of node.handlers) {
        lines.push(`### when ${handler.condition}`);
        lines.push("");
        for (const action of handler.actions) {
          const target = action.target ? ` ${action.target}` : "";
          lines.push(`- ${action.type}${target}`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  // ───────────── Workflow → JSON ─────────────

  /** Convert a WorkflowNode to a runnable JSON configuration. */
  private static workflowToJSON(node: WorkflowNode): object {
    return {
      type: "workflow",
      id: node.id,
      trigger: node.trigger || null,
      steps: node.steps.map((step) => ({
        id: step.id,
        agent: step.agent,
        action: step.action,
        requires: step.requires || null,
        onFail: step.onFail || null,
      })),
    };
  }

  // ───────────── Pipeline → JSON ─────────────

  /** Convert a PipelineNode to a runnable JSON configuration. */
  private static pipelineToJSON(node: PipelineNode): object {
    return {
      type: "pipeline",
      id: node.id,
      stages: node.stages.map((stage) => ({
        type: stage.type,
        tasks: stage.tasks.map((t) => ({
          agent: t.agent,
          action: t.action,
        })),
      })),
    };
  }

  // ───────────── Compile (write to disk) ─────────────

  /**
   * Compile all AST nodes and write output files to `outputDir`.
   *
   * - Agent nodes  → `<id>.agent.md` + `<id>.agent.json`
   * - Workflow nodes → `<id>.workflow.json`
   * - Pipeline nodes → `<id>.pipeline.json`
   *
   * @returns List of file paths written.
   */
  static async compile(
    nodes: ASTNode[],
    outputDir: string
  ): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });

    const written: string[] = [];

    for (const node of nodes) {
      switch (node.type) {
        case "agent": {
          // Write .agent.md
          const mdPath = join(outputDir, `${node.id}.agent.md`);
          await writeFile(mdPath, Transpiler.toAgentFile(node), "utf-8");
          written.push(mdPath);

          // Write .agent.json
          const jsonPath = join(outputDir, `${node.id}.agent.json`);
          const json = JSON.stringify(Transpiler.agentToJSON(node), null, 2);
          await writeFile(jsonPath, json, "utf-8");
          written.push(jsonPath);
          break;
        }

        case "workflow": {
          const path = join(outputDir, `${node.id}.workflow.json`);
          const json = JSON.stringify(
            Transpiler.workflowToJSON(node),
            null,
            2
          );
          await writeFile(path, json, "utf-8");
          written.push(path);
          break;
        }

        case "pipeline": {
          const path = join(outputDir, `${node.id}.pipeline.json`);
          const json = JSON.stringify(
            Transpiler.pipelineToJSON(node),
            null,
            2
          );
          await writeFile(path, json, "utf-8");
          written.push(path);
          break;
        }
      }
    }

    return written;
  }

  // ───────────── BAP-01 Registration ─────────────

  /**
   * Produce BAP-01 `register` messages for every agent node.
   * Non-agent nodes are skipped (they don't need registration).
   */
  static toRegistrationMessages(nodes: ASTNode[]): object[] {
    const messages: object[] = [];
    let sequence = 0;

    for (const node of nodes) {
      if (node.type !== "agent") continue;

      const agentJSON = Transpiler.agentToJSON(node) as Record<string, unknown>;

      messages.push({
        id: `reg-${node.id}-${++sequence}`,
        from: node.id,
        to: "registry",
        type: "register",
        payload: agentJSON,
        priority: 3,
        timestamp: Date.now(),
      });
    }

    return messages;
  }

  // ───────────── Internal Utilities ─────────────

  /** Normalise a property value that might be string or string[] to string. */
  private static toString(val: string | string[] | undefined): string {
    if (val === undefined) return "";
    return Array.isArray(val) ? val.join(", ") : val;
  }

  /** Normalise a property value to string[]. */
  private static toArray(val: string | string[] | undefined): string[] {
    if (val === undefined) return [];
    return Array.isArray(val) ? val : [val];
  }
}
