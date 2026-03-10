# Building an AETHER Power

A **Power** is a plugin package for the AETHER agent orchestration framework. Powers can provide MCP servers, steering instructions, and lifecycle hooks that extend agent capabilities.

## Directory Structure

```
my-power/
├── power.json              # Required — manifest file
├── steering.md             # Optional — agent steering instructions
├── hooks/                  # Optional — lifecycle hooks
│   └── on-change.hook.json
└── README.md               # Optional — documentation
```

## power.json Reference

| Field                    | Required | Description                                         |
| ------------------------ | -------- | --------------------------------------------------- |
| `name`                   | ✅       | Kebab-case identifier (e.g. `my-power`)             |
| `version`                | ✅       | Semver version (e.g. `1.0.0`)                       |
| `description`            | ✅       | Short human-readable description                    |
| `provider`               | ✅       | Author or organization name                         |
| `homepage`               | —        | URL to project homepage                             |
| `license`                | —        | SPDX license identifier                             |
| `mcp.server`             | —        | npm package name or local path to MCP server        |
| `mcp.command`            | —        | Command to launch the MCP server                    |
| `mcp.args`               | —        | Arguments to pass to the command                    |
| `mcp.env`                | —        | Environment variables for the MCP server            |
| `mcp.config`             | —        | Additional configuration passed to the MCP server   |
| `steering`               | —        | Array of relative paths to `.md` steering files     |
| `hooks`                  | —        | Array of relative paths to `.hook.json` files       |
| `activation.keywords`    | ✅       | Keywords that trigger this power in conversation    |
| `activation.filePatterns`| —        | Glob patterns for open files that trigger activation|
| `activation.manual`      | —        | If `true`, only activate via explicit selection     |
| `dependencies.powers`    | —        | Other powers this one depends on                    |
| `dependencies.npm`       | —        | npm packages required by this power                 |

## Activation

Powers are activated dynamically based on conversation context:

1. **Keyword matching** — Case-insensitive word-boundary match against conversation messages
2. **File patterns** — Glob matching against currently open files
3. **Explicit selection** — User manually selects the power
4. **Manual mode** — Set `manual: true` to require explicit activation only

## Installation

```bash
aether power install ./path/to/my-power
```

This copies the power to `.aether/powers/my-power/` and registers it.

## Steering Files

Steering files (`.md`) are injected into agent system prompts when the power is active. Use them to guide agent behavior within your power's domain.

## Hooks

Hook files (`.hook.json`) define lifecycle callbacks. See the hooks system documentation for the schema.

## Tips

- Keep activation keywords specific to avoid false positives
- Use `filePatterns` for powers tied to specific file types
- Set `manual: true` for powers with expensive MCP servers
- Document all MCP tools in your steering file so agents know what's available
