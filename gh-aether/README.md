# gh-aether

GitHub CLI extension for the AETHER multi-agent AI orchestrator.

## Install

```bash
# From local directory
gh extension install ./gh-aether

# From GitHub (after publishing)
gh extension install aether-framework/gh-aether
```

## Usage

```bash
# Route a task to the best agent
gh aether run "add pagination to the users API"

# Target a specific agent
gh aether run -a system-architect "design a caching layer"

# Review current PR
gh aether pr-review

# Create implementation plan from a GitHub issue
gh aether issue-plan 42

# Review staged changes before committing
gh aether commit-review

# Show system status
gh aether status

# List all agents
gh aether registry
```

## Requirements

- [Bun](https://bun.sh) runtime
- [GitHub CLI](https://cli.github.com/) v2.0+
- AETHER framework installed (parent directory)
- Gemini API key set: `export GOOGLE_AI_KEY=your-key`
