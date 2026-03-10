// Label taxonomy for AETHER issue automation

export const TAXONOMY = {
  component: [
    "agents",
    "providers",
    "core",
    "mcp",
    "cli",
    "vscode-extension",
    "hooks",
    "powers",
    "specs",
    "autonomous",
    "docs",
  ],
  os: ["os:windows", "os:mac", "os:linux"],
  theme: [
    "theme:performance",
    "theme:agent-quality",
    "theme:provider-error",
    "theme:config",
    "theme:security",
  ],
  workflow: [
    "pending-triage",
    "pending-response",
    "pending-maintainer-response",
    "duplicate",
    "question",
    "enhancement",
    "bug",
  ],
} as const;

export type ComponentLabel = (typeof TAXONOMY.component)[number];
export type OsLabel = (typeof TAXONOMY.os)[number];
export type ThemeLabel = (typeof TAXONOMY.theme)[number];
export type WorkflowLabel = (typeof TAXONOMY.workflow)[number];

export type TaxonomyLabel =
  | ComponentLabel
  | OsLabel
  | ThemeLabel
  | WorkflowLabel;

export const ALL_LABELS: string[] = [
  ...TAXONOMY.component,
  ...TAXONOMY.os,
  ...TAXONOMY.theme,
  ...TAXONOMY.workflow,
];

export function isValidLabel(label: string): label is TaxonomyLabel {
  return ALL_LABELS.includes(label);
}

/** Filter a list of candidate labels to only valid taxonomy labels */
export function filterValidLabels(candidates: string[]): string[] {
  return candidates.filter(isValidLabel);
}

export const TAXONOMY_PROMPT_DESCRIPTION = `
You are a GitHub issue classifier for the AETHER multi-agent orchestration framework.

Label taxonomy:
- component: ${TAXONOMY.component.join(", ")}
- os: ${TAXONOMY.os.join(", ")}
- theme: ${TAXONOMY.theme.join(", ")}
- workflow (type): ${TAXONOMY.workflow.filter((l) => !["pending-triage", "pending-response", "pending-maintainer-response", "duplicate"].includes(l)).join(", ")}

Rules:
1. Pick 1-3 labels total from the taxonomy above
2. Always include exactly one workflow type: "bug", "enhancement", or "question"
3. Include a component label if clearly identifiable
4. Include an os label only if OS-specific
5. Include a theme label if clearly applicable
6. Return valid JSON only
`.trim();
