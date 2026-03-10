// ─────────────────────────────────────────────────────────────
// Specs Templates — template strings for new spec creation
// ─────────────────────────────────────────────────────────────

export function getRequirementsTemplate(): string {
  return `# {{SPEC_NAME}} — Requirements

> Created: {{DATE}}
> Status: Draft

## Overview

{{DESCRIPTION}}

---

## R01 — {{SPEC_SLUG}}-core

**User Story:** As a user, I want {{DESCRIPTION}} so that I can achieve my goal.

**Acceptance Criteria:**

- AC-01.1: WHEN the feature is invoked, THE system SHALL perform the expected behavior
- AC-01.2: WHEN invalid input is provided, THE system SHALL return a clear error message

## R02 — {{SPEC_SLUG}}-validation

**User Story:** As a developer, I want input validation so that the system is robust.

**Acceptance Criteria:**

- AC-02.1: WHEN required fields are missing, THE validator SHALL reject the input
- AC-02.2: WHEN all fields are valid, THE validator SHALL accept the input
`;
}

export function getDesignTemplate(): string {
  return `# {{SPEC_NAME}} — Design Document

> Created: {{DATE}}
> Status: Draft

## Overview

{{DESCRIPTION}}

## Architecture

<!-- Describe the high-level architecture -->

### Components

1. **Component A** — Description
2. **Component B** — Description

### Data Flow

\`\`\`
Input → Component A → Component B → Output
\`\`\`

## API Design

### Interfaces

\`\`\`typescript
interface Example {
  id: string;
  // TODO: Define interface
}
\`\`\`

## Dependencies

- No external dependencies required

## Security Considerations

- Input validation on all public APIs
- No secrets in source code

## Testing Strategy

- Unit tests for each component
- Integration tests for data flow
`;
}

export function getTasksTemplate(): string {
  return `# {{SPEC_NAME}} — Tasks

> Created: {{DATE}}
> Status: In Progress

---

## 1. Setup and scaffolding

- [ ] 1.1 Create directory structure
- [ ] 1.2 Define TypeScript interfaces
- [ ] 1.3 Set up test scaffolding

_Requirements: R01_

## 2. Core implementation

- [ ] 2.1 Implement main logic
- [ ] 2.2 Add input validation
- [ ] 2.3 Add error handling

_Requirements: R01, R02_

## 3. Testing and validation

- [ ] 3.1 Write unit tests
- [ ] 3.2 Write integration tests
- [ ] 3.3 Verify all acceptance criteria

_Requirements: R01, R02_
`;
}
