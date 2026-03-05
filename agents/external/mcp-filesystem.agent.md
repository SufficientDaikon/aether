---
id: mcp-filesystem
name: MCP Filesystem Agent
tier: worker
sections: [TOOLS]
capabilities: [file-operations, directory-listing, file-search, file-read, file-write]
dependencies: []
llmRequirement: haiku
format: json
escalationTarget: system-architect
transport:
  type: mcp
  serverCommand: npx
  serverArgs: ["-y", "@modelcontextprotocol/server-filesystem", "/"]
  toolName: read_file
  argMapping:
    description: path
    context.content: content
  timeout: 15000
---

# MCP Filesystem Agent

Worker agent that delegates file operations to the MCP Filesystem server.
Useful for sandboxed file access when agents need to read/write files
without direct filesystem access.

## Available Tools
- `read_file` — Read file contents
- `write_file` — Write file contents
- `list_directory` — List directory contents
- `search_files` — Search for files by pattern
