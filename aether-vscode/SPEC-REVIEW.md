# AETHER VS Code Dashboard — Specification Compliance Review

**Specification**: `aether-vscode/SPEC.md`  
**Reviewer**: SDD Spec Compliance Auditor  
**Date**: 2026-08-03  
**Verdict**: ⚠️ **NEEDS REVISION** — Significant gaps found  
**Overall Score**: 78% (60-79% = Needs Revision)

---

## Executive Summary

The specification is **well-structured and ambitious**, covering all 13 required sections with a professional layout. It demonstrates strong product thinking (user stories with Given/When/Then), provides TypeScript interfaces for the core message protocol, and includes proper wireframes for all 7 dashboard tabs.

However, the spec has **critical gaps in the API contract** (7+ missing RPC methods for features it defines), **contradictions with existing code** (esbuild format, Node target, entry point path), **missing component definitions** (10+ components referenced but never specified), and an **incomplete migration plan** that fails to map existing panels/files to their new replacements.

### Key Metrics

| Metric                            | Count                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| Sections Present                  | 13/13 ✅ (plus 2 bonus: Success Criteria, Acceptance Checklist) |
| Sections Fully Compliant          | 5/13                                                            |
| Sections Partially Compliant      | 8/13                                                            |
| Critical Findings                 | 4                                                               |
| Major Findings                    | 9                                                               |
| Minor Findings                    | 7                                                               |
| Contradictions with Existing Code | 5                                                               |

---

## Section-by-Section Review

### 1. Product Overview — ✅ PASS (100%)

**Location**: Spec §1 (Lines 1–17)

The overview clearly articulates:

- **What**: Preact-based dashboard replacing vanilla DOM webview
- **Why**: 5 compelling reasons (productivity, UX, performance, maintainability, extensibility)
- **Who**: 3-tier user personas (developer, team lead, DevOps)

**Evidence**: Lines 3-17 — clear, concise, and well-motivated.

**Score**: No issues.

---

### 2. User Stories & Acceptance Criteria — ✅ PASS (90%)

**Location**: Spec §2 (Lines 24–153)

| Story  | Feature         | Format             | Testable   | Score      |
| ------ | --------------- | ------------------ | ---------- | ---------- |
| US-001 | Dashboard open  | Given/When/Then ✅ | ✅         | ✅ PASS    |
| US-002 | System health   | Given/When/Then ✅ | ✅         | ✅ PASS    |
| US-003 | Agent hierarchy | Given/When/Then ✅ | ✅         | ✅ PASS    |
| US-004 | Agent search    | Given/When/Then ✅ | ✅         | ✅ PASS    |
| US-005 | Task submission | Given/When/Then ✅ | ✅         | ✅ PASS    |
| US-006 | Task monitoring | Given/When/Then ✅ | ✅         | ✅ PASS    |
| US-007 | Rich chat       | Given/When/Then ✅ | ⚠️ Partial | ⚠️ PARTIAL |
| US-008 | Approvals       | Given/When/Then ✅ | ✅         | ✅ PASS    |
| US-009 | Memory search   | Given/When/Then ✅ | ✅         | ✅ PASS    |
| US-010 | Settings        | Given/When/Then ✅ | ✅         | ✅ PASS    |

**Finding M-01** (Minor): US-007 acceptance criterion "User prefers dashboard chat over Chat Participant" (SC-010) is subjective and not automatically testable. The AC should include specific measurable behaviors.

**Finding M-02** (Minor): No user story covers the **dual chat approach** — how the Chat Participant (existing `@aether`) and the new webview Chat tab coordinate. When does a user use which? Can conversations cross between them?

---

### 3. Technical Architecture — ⚠️ PARTIAL (75%)

**Location**: Spec §3 (Lines 154–197)

**What's good**:

- ASCII component diagram ✅ (Line 158-178)
- Data flow description with 5 numbered flows ✅ (Line 182-188)
- Technology stack with version numbers ✅ (Line 190-197)
- Correctly specifies Preact 10, Zustand, React Flow, markdown-it, Prism.js

**Finding CR-01** (Critical): **No Zustand store shape defined**. The spec says "Zustand stores in webview" (Line 169) but never defines what the store looks like. An implementer needs to know:

- What stores exist? (dashboard store, agents store, tasks store, chat store?)
- What state shape each store holds
- Which actions/selectors are available
- How stores synchronize with extension host state

**Finding MA-01** (Major): **No state synchronization protocol**. Line 169 says "synchronized with extension host" but never explains how. Does the webview request full state on load? Does the extension push deltas? Is there an optimistic update pattern?

**Finding MA-02** (Major): **Missing client-side routing specification**. Line 167 references "TabManager (Client-side Routing)" but there's no specification for how tabs work — URL-based? State-based? How is the active tab persisted across restarts?

**Architecture Decisions Verified**:

| Decision                           | Reflected?       | Location                                                               |
| ---------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| Preact 10 (3KB)                    | ✅               | §3.3 Line 191, §8.1 Line 998                                           |
| Tailwind + --vscode-\* CSS vars    | ✅               | §8.3 Lines 1074-1093                                                   |
| Typed RPC with correlation IDs     | ✅               | §4.1 Lines 204-237                                                     |
| Single WebviewPanel + client tabs  | ✅               | §3.1, §7.3                                                             |
| React Flow (@xyflow/react)         | ✅               | §3.3 Line 194                                                          |
| markdown-it                        | ✅               | §3.3 Line 195                                                          |
| Prism.js                           | ✅               | §3.3 Line 195                                                          |
| Own component library (no toolkit) | ✅               | §5                                                                     |
| Dual chat approach                 | ⚠️ Implicit only | §6.4 + §10.2 mention both but no interaction spec                      |
| Bundle target 180-210KB            | ⚠️ Contradictory | §3.3 says "~180-210KB total" but §11.1 says webview alone is 180-210KB |

---

### 4. API Contract — ⚠️ PARTIAL (65%)

**Location**: Spec §4 (Lines 199–460)

**What's good**:

- Well-structured base protocol with correlation IDs ✅
- TypeScript interfaces for all data models ✅
- Event types defined as discriminated union ✅
- Request/Response/Event pattern is clean ✅

**Finding CR-02** (Critical): **7+ RPC methods are missing**. The spec defines acceptance criteria requiring actions that have no corresponding RPC method:

| Missing RPC Method       | Required By                                       | User Story |
| ------------------------ | ------------------------------------------------- | ---------- |
| `cancelTask`             | "I can cancel or retry failed tasks"              | US-006     |
| `retryTask`              | "I can cancel or retry failed tasks"              | US-006     |
| `approveChange`          | "I can approve, reject, or request modifications" | US-008     |
| `rejectChange`           | "I can approve, reject, or request modifications" | US-008     |
| `batchApprove`           | "I can batch approve similar changes"             | US-008     |
| `setAutoApproveRules`    | "I can set auto-approve rules"                    | US-008     |
| `applyCodeBlock`         | "one-click apply functionality"                   | US-007     |
| `getConversationHistory` | "conversation history is searchable"              | US-007     |
| `saveDraft`              | "save as draft or submit immediately"             | US-005     |
| `getDrafts`              | implied by saveDraft                              | US-005     |
| `requestModifications`   | "request modifications" on approval               | US-008     |

**Finding CR-03** (Critical): **Two `ExtensionEvent` types defined with conflicting shapes**:

- §4.1 Line 220: `interface ExtensionEvent extends BaseMessage { type: "event"; event: string; data?: any; }`
- §4.3 Line 439: `type ExtensionEvent = | { event: "agent_status_changed" ... } | ...`

These are **contradictory TypeScript definitions**. The interface has `type`, `id`, `timestamp` from BaseMessage, but the union type has none of those fields. An implementer cannot use both.

**Finding MA-03** (Major): **`Attachment` interface referenced but never defined**. `ChatMessage.attachments` (Line 335) references `Attachment[]` but this type is never specified anywhere in the spec.

**Finding MA-04** (Major): **`AutoApprovalRule` interface referenced but never defined**. `Config.security.autoApprove.rules` (Line 425) references `AutoApprovalRule[]` but this type is never specified.

**Finding M-03** (Minor): Excessive use of `any` in typed interfaces. `WebviewRequest.params` (Line 213), `Task.result` (Line 316), `MemoryResult.context` (Line 386) use `any` which undermines the typed RPC goal. These should be specific types or `unknown`.

---

### 5. Component Specifications — ⚠️ PARTIAL (60%)

**Location**: Spec §5 (Lines 462–599)

**What's good**:

- 8 core components with full TypeScript interfaces ✅
- 6 specialized components with interfaces ✅
- Props are well-typed with appropriate optional fields ✅

**Finding CR-04** (Critical): **10+ components referenced in View Specifications (§6) but never defined in §5**:

| Missing Component         | Referenced In                            | View Spec Line      |
| ------------------------- | ---------------------------------------- | ------------------- |
| `Tabs` / `TabBar`         | Core navigation for the entire dashboard | §3.1 "TabManager"   |
| `Timeline`                | §6.1 "Components Used"                   | Line 631            |
| `ActivityHeatmap`         | §6.1 "Components Used"                   | Line 631            |
| `Select` / `Dropdown`     | §6.3, §6.4, §6.7 "Components Used"       | Lines 693, 721, 810 |
| `Checkbox`                | §6.7 "Components Used"                   | Line 810            |
| `FileSelect`              | §6.3 "Components Used"                   | Line 693            |
| `FormSection`             | §6.7 "Components Used"                   | Line 810            |
| `ChatMessage` (component) | §6.4 "Components Used"                   | Line 721            |
| `Panel` (slide-out)       | §6.2 "Components Used"                   | Line 665            |
| `Textarea`                | §6.3 task form "large text area"         | Line 689            |

An implementer cannot build the Overview tab without `Timeline` and `ActivityHeatmap` specs, cannot build the core shell without `Tabs`, and cannot build forms without `Select`, `Checkbox`, and `FileSelect`.

**Finding MA-05** (Major): **No component styling specification**. The spec defines component props but never defines:

- How components map to Tailwind classes
- How VS Code theme variables are applied
- Default visual appearance (colors, spacing, borders)
- How high-contrast themes are handled

---

### 6. View Specifications — ✅ PASS (95%)

**Location**: Spec §6 (Lines 601–810)

All 7 tabs are specified with:

- Purpose statement ✅
- ASCII wireframe layout ✅
- Component dependency list ✅

| Tab       | Wireframe | Components Listed                       | Score |
| --------- | --------- | --------------------------------------- | ----- |
| Overview  | ✅        | ✅ (but Timeline/Heatmap undefined)     | ⚠️    |
| Agents    | ✅        | ✅                                      | ✅    |
| Tasks     | ✅        | ✅ (but Select/FileSelect undefined)    | ⚠️    |
| Chat      | ✅        | ✅                                      | ✅    |
| Approvals | ✅        | ✅                                      | ✅    |
| Memory    | ✅        | ✅                                      | ✅    |
| Settings  | ✅        | ✅ (but Checkbox/FormSection undefined) | ⚠️    |

**Finding M-04** (Minor): No responsive behavior specified. What happens at narrow widths? VS Code panels can be as narrow as ~300px. Do cards stack? Do wireframes wrap?

---

### 7. Extension Host Changes — ⚠️ PARTIAL (65%)

**Location**: Spec §7 (Lines 812–988)

**What's good**:

- New `aether.dashboard` command with keybinding ✅
- Per-tab navigation commands ✅
- DashboardPanelManager with full class implementation ✅
- Serializer for state persistence ✅
- RPC dispatch method ✅

**Finding MA-06** (Major): **No deprecation plan for existing 4 panels**. The existing codebase has:

| Existing Panel        | File                            | Current Command           | Spec Status      |
| --------------------- | ------------------------------- | ------------------------- | ---------------- |
| `OrchestratorPanel`   | `src/panels/orchestrator.ts`    | `aether.showOrchestrator` | ❌ Not addressed |
| `CostDashboardPanel`  | `src/panels/task-history.ts`    | `aether.showCosts`        | ❌ Not addressed |
| `MemoryExplorerPanel` | `src/panels/memory-explorer.ts` | `aether.showMemory`       | ❌ Not addressed |
| `SettingsEditorPanel` | `src/panels/settings-editor.ts` | `aether.showSettings`     | ❌ Not addressed |

The spec needs to explicitly state:

- Are these panels deprecated immediately or kept as fallbacks?
- Do existing commands redirect to dashboard tabs?
- When are the old files deleted?

**Finding MA-07** (Major): **Editor features completely ignored**. The spec never mentions:

- `src/editor/codelens.ts` — CodeLens provider showing "Ask Agent" / "Test" lenses
- `src/editor/diagnostics.ts` — Agent-generated warnings/suggestions

These existing features need integration planning: should CodeLens commands open the dashboard? Should diagnostics appear in the dashboard?

**Finding MA-08** (Major): **Status bar integration not specified**. `src/status/status-bar.ts` currently links to `aether.showOrchestrator`. The spec needs to say whether it should link to `aether.dashboard` instead.

**Finding M-05** (Minor): The spec shows `handleWebviewMessage` registers two listeners for the `onDidReceiveMessage` event (Lines 917-935). The `initialTab` handler at Line 929 adds a second listener without removing it, which would leak.

---

### 8. Build System Changes — ⚠️ PARTIAL (70%)

**Location**: Spec §8 (Lines 990–1093)

**What's good**:

- Full dependency list with versions ✅
- Complete esbuild configuration for both bundles ✅
- Tailwind configuration with VS Code variables ✅
- Watch mode support ✅

**Finding MA-09** (Major): **5 contradictions with existing `esbuild.config.mjs`**:

| Setting          | Existing Code            | Spec Says                  | Impact                         |
| ---------------- | ------------------------ | -------------------------- | ------------------------------ |
| Webview format   | `format: "esm"`          | `format: "iife"`           | Breaking change, not explained |
| Webview target   | `target: "es2022"`       | `target: "es2020"`         | Downgrade, not explained       |
| Extension target | `target: "node20"`       | `target: "node16"`         | Downgrade, not explained       |
| Entry point      | `src/webview-ui/App.tsx` | `src/webview-ui/index.tsx` | File rename not mentioned      |
| Minify condition | `minify: !isWatch`       | `minify: production`       | Different flag mechanism       |

The spec should either match existing code or explicitly explain why these changes are needed.

**Finding M-06** (Minor): **PostCSS integration missing from esbuild config**. Tailwind CSS 3.x requires PostCSS processing. The spec shows a `tailwind.config.js` but never shows how PostCSS integrates with esbuild (a plugin is needed: `esbuild-postcss` or similar).

**Finding M-07** (Minor): **`isomorphic-dompurify` listed in §13.2 but not in §8.1 dependencies**. If used for input sanitization, it must be in the dependency list.

---

### 9. Testing Strategy — ⚠️ PARTIAL (60%)

**Location**: Spec §9 (Lines 1096–1168)

**What's good**:

- Test directory structure ✅
- Coverage target >80% ✅
- Performance tests with specific thresholds ✅
- E2E test examples ✅

**Finding MA-10** (Major): **No manual test plan**. The requirements explicitly ask for "unit tests, integration tests, manual test plans." The spec has unit and E2E tests but no manual test matrix for:

- Theme switching (light/dark/high-contrast)
- Screen reader testing with NVDA/JAWS
- Keyboard-only navigation walkthrough
- Browser zoom / font scaling

**Finding MA-11** (Major): **Test framework not specified**. The spec shows Jest-like syntax (`describe`, `test`, `expect`) but:

- Existing `package.json` uses `"test": "vscode-test"` (VS Code extension test runner)
- No mention of how Preact components are tested (Preact Testing Library? preact-render-to-string?)
- No mention of test runner for webview components (JSDOM? Happy-DOM?)
- The `jest-axe` import (Line 1326) implies Jest, but this was never confirmed

**Finding M-08** (Minor): Test file structure (Lines 1102-1118) only covers 3 of 7 tabs (Overview, Agents, Tasks). Missing test specs for Chat, Approvals, Memory, and Settings tabs.

---

### 10. Migration Plan — ⚠️ PARTIAL (70%)

**Location**: Spec §10 (Lines 1170–1241)

**What's good**:

- 7-phase timeline (one per week) ✅
- Backward compatibility stated ✅
- MigrationManager interface ✅
- Feature migration order is logical ✅

**Finding MA-12** (Major): **No file-level migration mapping**. The plan says "Migrate Overview tab from vanilla DOM" (Phase 2) but never maps specific existing files:

| Existing File                       | Replacement                     | Migration Phase |
| ----------------------------------- | ------------------------------- | --------------- |
| `src/panels/orchestrator.ts`        | Dashboard Agents tab?           | Not specified   |
| `src/panels/task-history.ts`        | Dashboard Overview/Tasks tab?   | Not specified   |
| `src/panels/memory-explorer.ts`     | Dashboard Memory tab?           | Not specified   |
| `src/panels/settings-editor.ts`     | Dashboard Settings tab?         | Not specified   |
| `src/webview-ui/App.tsx`            | New `src/webview-ui/index.tsx`? | Not specified   |
| `src/webview-ui/hooks/useAether.ts` | New MessageBus?                 | Not specified   |

**Finding MA-13** (Major): **Feature parity not verified**. The existing `App.tsx` has 4 views (orchestrator, costs, memory, settings). The new dashboard has 7 tabs. The spec never explicitly confirms that ALL existing functionality is preserved in the new tabs, e.g.:

- Existing SVG agent graph → React Flow (is parity guaranteed?)
- Existing memory search → new memory search (do the same MCP calls work?)

---

### 11. Performance Requirements — ✅ PASS (95%)

**Location**: Spec §11 (Lines 1243–1269)

**What's good**:

- Specific bundle size targets with target AND maximum columns ✅
- Runtime metrics with target AND maximum ✅
- 5 optimization strategies ✅

| Metric         | Target | Maximum | Specific? |
| -------------- | ------ | ------- | --------- |
| webview.js     | 180KB  | 210KB   | ✅        |
| extension.js   | 50KB   | 75KB    | ✅        |
| Total Assets   | 250KB  | 300KB   | ✅        |
| Dashboard Load | 300ms  | 500ms   | ✅        |
| Tab Switch     | 50ms   | 100ms   | ✅        |
| RPC Round Trip | 10ms   | 50ms    | ✅        |
| Memory Usage   | 50MB   | 100MB   | ✅        |

**Finding M-09** (Minor): **Bundle size contradiction**. §3.3 (Line 197) says "Bundle Target: ~180-210KB total" but §11.1 shows the webview bundle alone is 180-210KB, with total assets at 250-300KB. The §3.3 wording is misleading and should say "Webview bundle target" not "total."

---

### 12. Accessibility Requirements — ✅ PASS (85%)

**Location**: Spec §12 (Lines 1271–1345)

**What's good**:

- WCAG 2.1 AA Level A and AA requirements listed ✅
- Contrast ratios specified (4.5:1 and 3:1) ✅
- Focus management code with trap/restore ✅
- Screen reader announcements with live regions ✅
- Accessibility test examples with jest-axe ✅

**Finding M-10** (Minor): **Keyboard navigation not fully specified**. The spec says "keyboard navigation for all interactive elements" but doesn't define:

- Tab order within the dashboard (tab bar → tab content → actions)
- Keyboard shortcuts for tab switching (Ctrl+1 through Ctrl+7?)
- Arrow key navigation within React Flow diagram
- Escape key behavior for modals/panels

**Finding M-11** (Minor): **React Flow accessibility not addressed**. The agent hierarchy diagram (React Flow) is notoriously difficult for screen readers. The spec should address how a non-visual user navigates the agent tree — perhaps with an alternative list view.

---

### 13. Security Requirements — ✅ PASS (80%)

**Location**: Spec §13 (Lines 1347–1421)

**What's good**:

- CSP policy with nonce ✅ (matches existing panel pattern)
- DOMPurify for input sanitization ✅
- RPC message validation ✅
- Sensitive field redaction in logging ✅
- VS Code secrets API for API keys ✅

**Finding M-12** (Minor): **CSP allows `style-src 'unsafe-inline'`**. While this is common for VS Code webviews (needed for inline styles), the spec should acknowledge this as a known compromise and explain why it's necessary (Tailwind utility classes, VS Code theme variables).

**Finding M-13** (Minor): **No sanitization for markdown-it output**. The spec sanitizes user input with DOMPurify but markdown-it renders HTML from markdown. Agent responses containing malicious markdown could inject content. The spec should specify that markdown-it output is also sanitized or that markdown-it's built-in HTML escaping is relied upon.

---

## Existing Code Accounting

| Required File/Directory             | Referenced in Spec? | Details                                                                  |
| ----------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `src/extension.ts`                  | ✅ Yes              | §7.2 shows specific changes                                              |
| `src/aether-bridge.ts`              | ✅ Yes              | Referenced in §3.1 diagram and §7.3 constructor                          |
| `src/chat/participant.ts`           | ⚠️ Implicit         | §10.2 says "Maintain Chat Participant API" but file not named            |
| `src/chat/commands.ts`              | ❌ No               | Slash commands are discussed but file never referenced                   |
| `src/sidebar/agents-tree.ts`        | ⚠️ Generic          | §10.2 says "Keep existing sidebar TreeViews" — file not named            |
| `src/sidebar/tasks-tree.ts`         | ⚠️ Generic          | Same as above                                                            |
| `src/sidebar/contexts-tree.ts`      | ⚠️ Generic          | Same as above                                                            |
| `src/sidebar/knowledge-tree.ts`     | ⚠️ Generic          | Same as above                                                            |
| `src/panels/orchestrator.ts`        | ❌ No               | Panel exists but no deprecation/migration plan                           |
| `src/panels/task-history.ts`        | ❌ No               | Same                                                                     |
| `src/panels/memory-explorer.ts`     | ❌ No               | Same                                                                     |
| `src/panels/settings-editor.ts`     | ❌ No               | Same                                                                     |
| `src/editor/codelens.ts`            | ❌ No               | Completely unmentioned                                                   |
| `src/editor/diagnostics.ts`         | ❌ No               | Completely unmentioned                                                   |
| `src/status/status-bar.ts`          | ❌ No               | Completely unmentioned                                                   |
| `src/webview-ui/App.tsx`            | ⚠️ Partial          | Entry point referenced but migration of existing code not detailed       |
| `src/webview-ui/hooks/useAether.ts` | ❌ No               | Existing messaging hook not mentioned; presumably replaced by MessageBus |
| `esbuild.config.mjs`                | ✅ Yes              | §8.2 shows replacement config                                            |
| `package.json`                      | ✅ Yes              | §8.1 shows additions                                                     |

**Summary**: Only 3 of 19 files are properly referenced. 6 files are completely unmentioned. 8 files have only generic/implicit references.

---

## Contradiction Analysis

| #    | Contradiction                                              | Locations                              | Severity |
| ---- | ---------------------------------------------------------- | -------------------------------------- | -------- |
| C-01 | Bundle size "total" in §3.3 vs "webview only" in §11.1     | §3.3 L197 vs §11.1 L1248               | Minor    |
| C-02 | Two conflicting `ExtensionEvent` definitions               | §4.1 L220 vs §4.3 L439                 | Critical |
| C-03 | esbuild `format: "esm"` (existing) vs `"iife"` (spec)      | `esbuild.config.mjs` L24 vs §8.2 L1028 | Major    |
| C-04 | esbuild `target: "es2022"` (existing) vs `"es2020"` (spec) | `esbuild.config.mjs` L26 vs §8.2 L1034 | Minor    |
| C-05 | Node target `"node20"` (existing) vs `"node16"` (spec)     | `esbuild.config.mjs` L16 vs §8.2 L1052 | Major    |
| C-06 | Entry point `App.tsx` (existing) vs `index.tsx` (spec)     | `esbuild.config.mjs` L23 vs §8.2 L1027 | Major    |

---

## Findings Summary

### Critical (Must Fix Before Implementation)

| ID    | Finding                                          | Section | Impact                                               |
| ----- | ------------------------------------------------ | ------- | ---------------------------------------------------- |
| CR-01 | No Zustand store shape defined                   | §3      | Implementer must invent state architecture           |
| CR-02 | 7+ RPC methods missing for specified features    | §4      | Cannot implement cancel/retry, approvals, code apply |
| CR-03 | Contradictory `ExtensionEvent` type definitions  | §4      | TypeScript compilation error guaranteed              |
| CR-04 | 10+ UI components referenced but never specified | §5      | Cannot implement Overview, Tasks, Settings tabs      |

### Major (Should Fix Before Implementation)

| ID    | Finding                                               | Section | Impact                                           |
| ----- | ----------------------------------------------------- | ------- | ------------------------------------------------ |
| MA-01 | No state synchronization protocol                     | §3      | Implementer must design state sync from scratch  |
| MA-02 | Client-side routing/tab management unspecified        | §3      | Core UX pattern undefined                        |
| MA-03 | `Attachment` interface referenced but undefined       | §4      | ChatMessage type is incomplete                   |
| MA-04 | `AutoApprovalRule` interface referenced but undefined | §4      | Config type is incomplete                        |
| MA-05 | No component styling specification                    | §5      | Visual appearance left to implementer discretion |
| MA-06 | No deprecation plan for existing 4 panels             | §7      | Risk of breaking existing functionality          |
| MA-07 | Editor features (CodeLens, Diagnostics) not addressed | §7      | Integration gap                                  |
| MA-08 | Status bar integration not specified                  | §7      | Existing `status-bar.ts` orphaned                |
| MA-09 | 5 contradictions with existing esbuild config         | §8      | Build will fail or behave differently            |
| MA-10 | No manual test plan                                   | §9      | Cannot verify a11y, theme, keyboard manually     |
| MA-11 | Test framework not specified                          | §9      | Implementer must choose and configure test infra |
| MA-12 | No file-level migration mapping                       | §10     | Implementer doesn't know which files to touch    |
| MA-13 | Feature parity not verified between old/new           | §10     | Risk of regressions                              |

### Minor (Nice to Fix)

| ID   | Finding                                         | Section | Impact                                         |
| ---- | ----------------------------------------------- | ------- | ---------------------------------------------- |
| M-01 | US-007 "prefers dashboard chat" AC not testable | §2      | Subjective criterion                           |
| M-02 | No dual chat interaction spec                   | §2      | Chat Participant ↔ webview chat unclear        |
| M-03 | Excessive `any` types in RPC interfaces         | §4      | Undermines type safety                         |
| M-04 | No responsive behavior spec for views           | §6      | Narrow panel layout undefined                  |
| M-05 | Double message listener leak in panel manager   | §7      | Memory leak in code example                    |
| M-06 | PostCSS/esbuild integration missing             | §8      | Tailwind won't compile without plugin          |
| M-07 | DOMPurify not in dependency list                | §8      | Runtime import will fail                       |
| M-08 | Test specs only cover 3 of 7 tabs               | §9      | Incomplete test coverage plan                  |
| M-09 | Bundle size wording contradiction (§3 vs §11)   | §11     | Confusing for implementer                      |
| M-10 | Keyboard navigation shortcuts not defined       | §12     | A11y implementation left to discretion         |
| M-11 | React Flow screen reader support not addressed  | §12     | Agent hierarchy inaccessible to screen readers |
| M-12 | CSP `unsafe-inline` not justified               | §13     | Security compromise without explanation        |
| M-13 | markdown-it output not sanitized                | §13     | Potential XSS from agent markdown              |

---

## Recommendations

### Priority 1 — Fix Before Implementation Begins

1. **Define all missing RPC methods** (CR-02): Add TypeScript interfaces for `cancelTask`, `retryTask`, `approveChange`, `rejectChange`, `batchApprove`, `setAutoApproveRules`, `applyCodeBlock`, `getConversationHistory`, `saveDraft`, `getDrafts`, `requestModifications`.

2. **Resolve `ExtensionEvent` contradiction** (CR-03): Pick one pattern — either the interface extending BaseMessage OR the discriminated union — not both.

3. **Define missing components** (CR-04): Add TypeScript interfaces and behavior descriptions for `Tabs`, `Timeline`, `ActivityHeatmap`, `Select`, `Checkbox`, `FileSelect`, `FormSection`, `ChatMessage` (component), `Panel`, `Textarea`.

4. **Define Zustand store shapes** (CR-01): Add a State Management section with store interfaces, e.g.:
   ```typescript
   interface DashboardStore {
     activeTab: TabId;
     systemStatus: SystemStatus | null;
     // ...
   }
   ```

### Priority 2 — Fix Before Phase 1 Starts

5. **Add file-level migration matrix** (MA-06, MA-12): Create a table mapping every existing file to its new dashboard equivalent and the migration phase in which it changes.

6. **Resolve esbuild contradictions** (MA-09): Either match existing `esbuild.config.mjs` settings or explain each change.

7. **Specify test framework** (MA-11): Explicitly choose Jest/Vitest, add Preact Testing Library, and specify JSDOM vs Happy-DOM for component tests.

8. **Add dual chat interaction spec** (M-02): Document when users should use `@aether` in Chat panel vs. the webview Chat tab, and whether conversation state is shared.

### Priority 3 — Fix During Implementation

9. Add `isomorphic-dompurify` to dependency list (M-07).
10. Add PostCSS esbuild plugin to build config (M-06).
11. Define keyboard navigation shortcuts (M-10).
12. Add manual test plan for a11y and themes (MA-10).

---

## Verdict

### ⚠️ NEEDS REVISION

**Score: 78/100**

The specification is well-intentioned and covers impressive breadth. The wireframes, user stories, and performance targets are excellent. However, an implementer picking up this spec today would immediately hit blockers:

1. They can't build the RPC layer without the 7+ missing method definitions
2. They can't build the UI without 10+ undefined component specs
3. They'll get TypeScript errors from the contradictory `ExtensionEvent` types
4. They'll encounter build failures from esbuild config mismatches
5. They won't know what to do with existing panels, CodeLens, or status bar

**The spec needs approximately 1 day of focused revision to become implementation-ready.**

Once the 4 critical and 5 highest-priority major findings are resolved, this spec would score in the **APPROVED WITH CONDITIONS** range (85-90%).

---

_Report generated by SDD Specification Compliance Auditor_  
_Methodology: Section-by-section audit against 13 required areas + architecture decisions + existing code accounting_
