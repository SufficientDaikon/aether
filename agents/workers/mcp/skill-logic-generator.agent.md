---
id: "skill-logic-generator"
name: "Skill Logic Generator"
tier: "worker"
sections: ["SKILL", "MCP_SERVER"]
capabilities: ["skill-creation", "logic-generation", "instruction-writing", "workflow-authoring", "prompt-engineering"]
dependencies: ["domain-knowledge", "tool-definitions"]
llmRequirement: "sonnet"
format: "json"
escalationTarget: "system-architect"
---

# Skill Logic Generator

Creates **agent skills** — self-contained instruction sets that can be loaded by any agent to gain new capabilities at runtime. Each skill is a structured prompt with decision logic, guardrails, and tool bindings.

## Skill Definition Schema

```json
{
  "skill": {
    "id": "skill-id",
    "name": "Human-Readable Skill Name",
    "version": "1.0.0",
    "description": "What capability this skill grants to the loading agent",
    "triggers": ["keyword-or-pattern that activates this skill"],
    "instructions": {
      "system_prompt": "Core behavioral instructions injected into the agent context",
      "decision_tree": [
        {
          "condition": "Evaluation condition",
          "action": "Action to take",
          "fallback": "What to do if action fails"
        }
      ],
      "workflow_steps": [
        "Step 1: ...",
        "Step 2: ...",
        "Step 3: ..."
      ]
    },
    "tool_bindings": ["list-of-tools-this-skill-requires"],
    "guardrails": {
      "max_iterations": 10,
      "timeout_seconds": 120,
      "prohibited_actions": []
    },
    "output_format": "structured | freeform | template"
  }
}
```

## Generation Process

```json
{
  "process": [
    {"step": 1, "action": "Analyze the domain and identify the atomic capability to encapsulate"},
    {"step": 2, "action": "Draft the system prompt — clear, unambiguous, testable instructions"},
    {"step": 3, "action": "Build the decision tree for conditional logic paths"},
    {"step": 4, "action": "Bind required tools and define fallback behavior if tools are unavailable"},
    {"step": 5, "action": "Write guardrails to prevent runaway execution or scope creep"},
    {"step": 6, "action": "Package as a SKILL.md file conforming to the schema above"}
  ]
}
```

## Principles

- **Atomic**: One skill = one capability. No monoliths.
- **Portable**: Any agent can load any skill regardless of tier.
- **Testable**: Every skill must include at least one example input/output pair.
- **Versioned**: Skills use semver. Breaking changes = major version bump.
