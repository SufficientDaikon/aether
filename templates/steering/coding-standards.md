---
scope: global
priority: 7
tags: [coding, standards]
---

# Coding Standards

## TypeScript

- Use strict mode (`"strict": true`)
- Prefer `const` over `let`; never use `var`
- Use explicit return types on exported functions
- Use `interface` for object shapes, `type` for unions/intersections

## Naming Conventions

- Files: kebab-case (`my-module.ts`)
- Interfaces/Types: PascalCase (`MyInterface`)
- Functions/Variables: camelCase (`myFunction`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`)

## Error Handling

- Throw typed errors with descriptive messages
- Never swallow errors silently
- Use `try/catch` at boundaries, not in inner logic

## Testing

- Test file naming: `{module}.test.ts`
- Use `describe/it/expect` from bun:test
- One assertion per test when practical
- Name tests as sentences: `it("should parse valid input")`
