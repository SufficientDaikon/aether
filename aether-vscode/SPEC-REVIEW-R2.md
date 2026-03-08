# AETHER VS Code Dashboard — Specification Re-Review (Round 2)

**Specification**: `aether-vscode/SPEC.md` (revised)  
**Prior Review**: `aether-vscode/SPEC-REVIEW.md` (Round 1, score 78/100)  
**Reviewer**: SDD Spec Compliance Auditor  
**Date**: 2026-08-03  
**Verdict**: ✅ **APPROVED WITH CONDITIONS** — Implementation-ready with minor gaps  
**Overall Score**: 92/100 (80-94% = Approved With Conditions)

---

## Executive Summary

The revised specification addresses **all 4 critical findings** and **10 of 13 major findings** from the Round 1 review. The spec has gone from "an implementer would immediately hit blockers" to "an implementer can begin work today with only minor ambiguity." The most impactful improvements are the fully-defined Zustand store architecture (CR-01), the 11 new RPC method interfaces (CR-02), the resolved `ExtensionEvent` naming conflict (CR-03), and the 11 newly-specified UI components (CR-04).

### Score Comparison

| Metric            | Round 1           | Round 2                          | Change       |
| ----------------- | ----------------- | -------------------------------- | ------------ |
| **Overall Score** | 78/100            | 92/100                           | **+14**      |
| **Verdict**       | ⚠️ NEEDS REVISION | ✅ APPROVED W/ CONDITIONS        | **Upgraded** |
| Critical Issues   | 4                 | **0**                            | -4 ✅        |
| Major Issues      | 13                | **3** (1 open, 2 partial)        | -10          |
| Minor Issues      | 13                | **9** (3 open, 4 partial, 2 new) | -2 net       |

---

## Part 1 — Critical Findings Verification (4/4 Resolved)

### CR-01: No Zustand store shape defined — ✅ RESOLVED

**Original**: §3 mentioned "Zustand stores" but never defined store interfaces, shapes, actions, or synchronization protocol.

**Evidence in revised spec**: §3.3 (Lines 190-322) now provides:

- `DashboardStore` — UI state, active tab, tab history, theme (Lines 194-207)
- `SystemStore` — health data, connection state, real-time updates (Lines 210-224)
- `AgentsStore` — agent records, hierarchy, filters, selection (Lines 227-249)
- `TasksStore` — task records, hierarchy, expanded state, form state (Lines 252-276)
- `ChatStore` — messages, input state, commands, context files (Lines 279-301)
- `StoreSyncManager` — sync protocol interface (Lines 304-314)
- **State Synchronization Protocol** with 4 explicit steps: Initial Load → Real-time Updates → Optimistic Actions → Error Rollback (Lines 317-322)

**Quality**: Excellent. All stores have typed state fields AND typed action methods. The sync protocol covers the full lifecycle. An implementer can build directly from these interfaces.

---

### CR-02: 7+ RPC methods missing — ✅ RESOLVED

**Original**: 11 RPC methods required by acceptance criteria had no interface definitions.

**Evidence in revised spec**: §4.2 (Lines 535-601) now defines all missing methods:

| Missing Method           | Now Defined                                                | Location      |
| ------------------------ | ---------------------------------------------------------- | ------------- |
| `cancelTask`             | `CancelTaskParams { taskId, reason? }`                     | Lines 535-538 |
| `retryTask`              | `RetryTaskParams { taskId, resetProgress? }`               | Lines 540-543 |
| `approveChange`          | `ApproveChangeParams { approvalId, comment? }`             | Lines 546-549 |
| `rejectChange`           | `RejectChangeParams { approvalId, reason }`                | Lines 551-554 |
| `batchApprove`           | `BatchApproveParams { approvalIds[], comment? }`           | Lines 556-559 |
| `requestModifications`   | `RequestModificationsParams { approvalId, modifications }` | Lines 561-564 |
| `setAutoApproveRules`    | `SetAutoApproveRulesParams { rules[] }`                    | Lines 566-568 |
| `applyCodeBlock`         | `ApplyCodeBlockParams { blockId, filename? }`              | Lines 571-574 |
| `getConversationHistory` | `GetConversationHistoryParams { limit?, before?, agent? }` | Lines 577-581 |
| `saveDraft`              | `SaveDraftParams { content, type, metadata? }`             | Lines 583-588 |
| `getDrafts`              | `GetDraftsParams { type? }` + `Draft` interface            | Lines 590-601 |

**Quality**: Complete. Every acceptance criterion in §2 now has a corresponding RPC method.

---

### CR-03: Contradictory ExtensionEvent type definitions — ✅ RESOLVED

**Original**: Two types both named `ExtensionEvent` — one extending `BaseMessage`, one a discriminated union — guaranteed TypeScript compilation errors.

**Evidence in revised spec**: The names are now distinct:

- §4.1 Line 367: `interface ExtensionEventMessage extends BaseMessage` — the wire format with id, type, timestamp
- §4.3 Line 675: `type ExtensionEvent = | { event: "agent_status_changed" ... } | ...` — the application-level discriminated union

**Quality**: Clean separation. `ExtensionEventMessage` is the transport envelope; `ExtensionEvent` is the payload shape. No naming conflict.

---

### CR-04: 10+ UI components referenced but never specified — ✅ RESOLVED

**Original**: Tabs, Timeline, ActivityHeatmap, Select, Checkbox, FileSelect, FormSection, ChatMessage (component), Panel, Textarea all referenced in §6 view specs but never defined in §5.

**Evidence in revised spec**: §5.2 (Lines 836-943) now defines all 11 missing components:

| Component                 | Interface                                                                        | Lines   |
| ------------------------- | -------------------------------------------------------------------------------- | ------- |
| `Tabs`                    | `TabsProps { value, onChange, children }`                                        | 837-841 |
| `Tab`                     | `TabProps { value, label, icon?, badge?, disabled? }`                            | 843-849 |
| `Timeline`                | `TimelineProps { items[], compact? }` + `TimelineItem`                           | 851-863 |
| `ActivityHeatmap`         | `ActivityHeatmapProps { data[], startDate, endDate, onClick? }` + `ActivityData` | 865-876 |
| `Select`                  | `SelectProps { value, onChange, options[], multiple? }` + `SelectOption`         | 878-893 |
| `Checkbox`                | `CheckboxProps { checked, onChange, label?, indeterminate? }`                    | 895-902 |
| `Textarea`                | `TextareaProps { value, onChange, rows?, resize? }`                              | 904-912 |
| `FileSelect`              | `FileSelectProps { value?, onChange, multiple?, accept? }`                       | 914-921 |
| `FormSection`             | `FormSectionProps { title, description?, collapsible? }`                         | 923-928 |
| `Panel` (slide-out)       | `PanelProps { open, onClose, side?, width?, title? }`                            | 930-936 |
| `ChatMessage` (component) | `ChatMessageComponentProps { message, onApplyCode?, onRetry? }`                  | 938-943 |

**Quality**: Good. All referenced components now have full prop interfaces. An implementer can build every view in §6 without inventing missing APIs.

---

## Part 2 — Major Findings Verification

### MA-01: No state synchronization protocol — ✅ RESOLVED

§3.3 Lines 317-322 define a 4-step protocol: Initial Load, Real-time Events, Optimistic Updates, Error Rollback.

### MA-02: Client-side routing/tab management unspecified — ⚠️ MOSTLY RESOLVED

`DashboardStore.activeTab` (Line 196) + `TabsProps` (Line 837) + serializer in §7.2 (Line 1206) collectively cover tab management. State-based routing is clear. However, tab persistence on restart relies on the serializer but the stored state shape for `deserializeWebviewPanel` (Line 1207) is never defined.
**Residual gap**: Minor — serializer state shape undefined.

### MA-03: Attachment interface referenced but undefined — ✅ RESOLVED

`Attachment` interface at Lines 481-489 with `id, type, name, content?, url?, size?, mimeType?`.

### MA-04: AutoApprovalRule interface referenced but undefined — ✅ RESOLVED

`AutoApprovalRule` at Lines 650-668 with conditions (filePatterns, agents, changeTypes, maxLinesChanged) and actions (autoApprove, notifyUser, logLevel).

### MA-05: No component styling specification — ❌ NOT RESOLVED

Components in §5 still only have TypeScript prop interfaces. There is no specification for:

- How `variant="primary"` maps to Tailwind classes or CSS
- Default visual appearance of components (colors, spacing, borders)
- How VS Code theme variables are applied to each component
- High-contrast theme handling per component

§8.3 has the Tailwind config with `--vscode-*` variables, but individual component styling remains at implementer discretion.

### MA-06: No deprecation plan for existing 4 panels — ✅ RESOLVED

§10.2 Lines 1676-1697 provides a full migration table with file paths, commands, target dashboard tabs, migration phases, and deprecation timeline (v2.0).

### MA-07: Editor features (CodeLens, Diagnostics) not addressed — ✅ RESOLVED

§10.2 Lines 1699-1704: CodeLens → Tasks tab (Phase 4), Diagnostics → Overview tab (Phase 2).

### MA-08: Status bar integration not specified — ✅ RESOLVED

§10.2 Line 1704: Status Bar → Phase 1, update click handler to `aether.dashboard`.

### MA-09: 5 contradictions with existing esbuild config — ✅ RESOLVED

§8.2 Lines 1368-1375 explicitly aligns with existing config: `esm` format, `es2022` target, `node20`, `App.tsx` entry point, `!isWatch` minify pattern. All 5 contradictions eliminated.

### MA-10: No manual test plan — ✅ RESOLVED

§9.4 Lines 1560-1617 is comprehensive: accessibility matrix (6 scenarios), theme testing (3 scenarios), responsive testing (4 breakpoints), keyboard navigation (5 flows), browser zoom (5 levels), performance manual (5 scenarios).

### MA-11: Test framework not specified — ⚠️ PARTIALLY RESOLVED

§12.3 uses `jest-axe` (Line 1856) and `render`/`screen` (Lines 1861, 1868) implying Jest + Testing Library, but the spec never explicitly states: "Use Jest with Preact Testing Library and Happy-DOM/JSDOM." An implementer must infer the framework from code examples.
**Residual gap**: Test framework choice is implicit, not stated.

### MA-12: No file-level migration mapping — ✅ RESOLVED

§10.4 Lines 1725-1745 has explicit "Files to Modify" (8 files) and "Files to Deprecate" (4 files) lists.

### MA-13: Feature parity not verified — ✅ RESOLVED

§10.4 Lines 1748-1757 has a "Feature Parity Verification" table with 6 features, current location, new location, and verification method.

### Major Findings Summary

| ID    | Finding                       | R1 Status | R2 Status              | Score |
| ----- | ----------------------------- | --------- | ---------------------- | ----- |
| MA-01 | State sync protocol           | Open      | **Resolved**           | ✅    |
| MA-02 | Tab management / routing      | Open      | **Mostly Resolved**    | ⚠️    |
| MA-03 | Attachment interface          | Open      | **Resolved**           | ✅    |
| MA-04 | AutoApprovalRule interface    | Open      | **Resolved**           | ✅    |
| MA-05 | Component styling spec        | Open      | **Still Open**         | ❌    |
| MA-06 | Panel deprecation plan        | Open      | **Resolved**           | ✅    |
| MA-07 | Editor features integration   | Open      | **Resolved**           | ✅    |
| MA-08 | Status bar integration        | Open      | **Resolved**           | ✅    |
| MA-09 | esbuild config contradictions | Open      | **Resolved**           | ✅    |
| MA-10 | Manual test plan              | Open      | **Resolved**           | ✅    |
| MA-11 | Test framework specification  | Open      | **Partially Resolved** | ⚠️    |
| MA-12 | File-level migration mapping  | Open      | **Resolved**           | ✅    |
| MA-13 | Feature parity verification   | Open      | **Resolved**           | ✅    |

**Result**: 10 ✅ / 2 ⚠️ / 1 ❌

---

## Part 3 — Minor Findings Verification

| ID   | Finding                            | R2 Status     | Evidence                                                                                 |
| ---- | ---------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| M-01 | US-007 "prefers chat" not testable | ❌ Still open | SC-010 (L2027) still says ">70% preference" — subjective                                 |
| M-02 | No dual chat interaction spec      | ❌ Still open | §10.3 says "maintain Chat Participant" but no interaction design                         |
| M-03 | Excessive `any` types              | ❌ Still open | `WebviewRequest.params` (L352), `Task.result` (L450), `StoreSyncManager` (L307-308)      |
| M-04 | No responsive behavior in views    | ⚠️ Partial    | §9.4 responsive test matrix added (L1585), but §6 wireframes have no responsive variants |
| M-05 | Double message listener leak       | ✅ Resolved   | §7.3 L1274-1283: `readyListener.dispose()` after ready message                           |
| M-06 | PostCSS/esbuild integration        | ✅ Resolved   | §8.2 L1417-1438: inline PostCSS plugin with tailwindcss + autoprefixer                   |
| M-07 | DOMPurify not in dependencies      | ✅ Resolved   | §8.1 L1354: `"isomorphic-dompurify": "^2.8.0"`                                           |
| M-08 | Test specs only 3/7 tabs           | ❌ Still open | §9.1 L1497-1507 still only shows Overview, Agents, Tasks test files                      |
| M-09 | Bundle size wording contradiction  | ⚠️ Partial    | §11.1 L1773 adds clarification note, but §3.4 L332 still says "~180-210KB total"         |
| M-10 | Keyboard shortcuts not defined     | ⚠️ Partial    | §9.4 L1592-1599 has keyboard test flows but no formal shortcut table in §12              |
| M-11 | React Flow screen reader support   | ⚠️ Partial    | §9.4 L1593 covers keyboard nav of hierarchy; no alt list view for screen readers         |
| M-12 | CSP unsafe-inline not justified    | ✅ Resolved   | §13.1 L1893-1907: detailed justification block with 4 numbered explanations              |
| M-13 | markdown-it output not sanitized   | ✅ Resolved   | §13.2 L1917-1947: `createSecureMarkdownRenderer()` with DOMPurify + ALLOWED_TAGS         |

**Result**: 5 ✅ / 4 ⚠️ / 4 ❌

---

## Part 4 — New Issues Introduced by Revision

### NEW-01 (Minor): Duplicate §10.3 "Backward Compatibility" sections

**Location**: Lines 1706-1713 and Lines 1715-1724 are two copies of `### 10.3 Backward Compatibility`. The second version (1715-1724) is the improved one with more detail. The first (1706-1713) is the original stub and should be removed.

### NEW-02 (Minor): Duplicate §13.3 "Input Sanitization" header

**Location**: Lines 1950-1952 show the heading `### 13.3 Input Sanitization` printed twice consecutively. One should be removed.

---

## Part 5 — Section-by-Section Score Update

| Section                   | R1 Score | R2 Score | Change | Key Improvements                             |
| ------------------------- | -------- | -------- | ------ | -------------------------------------------- |
| §1 Product Overview       | 100%     | 100%     | —      | No changes needed                            |
| §2 User Stories           | 90%      | 90%      | —      | M-01, M-02 remain                            |
| §3 Technical Architecture | 75%      | **95%**  | +20    | CR-01, MA-01, MA-02 resolved                 |
| §4 API Contract           | 65%      | **95%**  | +30    | CR-02, CR-03, MA-03, MA-04 resolved          |
| §5 Component Specs        | 60%      | **85%**  | +25    | CR-04 resolved; MA-05 remains                |
| §6 View Specifications    | 95%      | **97%**  | +2     | All referenced components now defined        |
| §7 Extension Host         | 65%      | **92%**  | +27    | MA-06/07/08, M-05 resolved                   |
| §8 Build System           | 70%      | **95%**  | +25    | MA-09, M-06, M-07 resolved                   |
| §9 Testing Strategy       | 60%      | **85%**  | +25    | MA-10 resolved; MA-11, M-08 partially remain |
| §10 Migration Plan        | 70%      | **95%**  | +25    | MA-12, MA-13 resolved; full tables added     |
| §11 Performance           | 95%      | **97%**  | +2     | §11.1 clarification note added               |
| §12 Accessibility         | 85%      | **90%**  | +5     | M-10/11 partially addressed via test plan    |
| §13 Security              | 80%      | **95%**  | +15    | M-12, M-13 resolved                          |

**Weighted Average**: 92/100

---

## Part 6 — Implementation Readiness Assessment

### Can an implementer start today?

| Capability                  | R1 Answer                         | R2 Answer                         |
| --------------------------- | --------------------------------- | --------------------------------- |
| Build the RPC layer?        | ❌ 11 methods missing             | ✅ All methods defined            |
| Build the UI components?    | ❌ 10+ components undefined       | ✅ All components have interfaces |
| Compile TypeScript?         | ❌ ExtensionEvent naming conflict | ✅ Names disambiguated            |
| Configure esbuild?          | ❌ 5 contradictions               | ✅ Aligned with existing config   |
| Know what files to touch?   | ❌ No migration mapping           | ✅ Full file-level mapping        |
| Set up state management?    | ❌ No store shapes                | ✅ 5 stores + sync protocol       |
| Run the build?              | ❌ PostCSS missing                | ✅ Inline PostCSS plugin included |
| Know what to test manually? | ❌ No manual plan                 | ✅ 30+ manual test scenarios      |

**Answer**: Yes. An implementer can start today. The remaining gaps (component styling, test framework naming, a few `any` types) are low-risk and can be resolved during implementation without blocking work.

---

## Remaining Issues — Ranked by Priority

### Should fix before or during Phase 1:

1. **MA-05** (Major): Add component styling specification — at minimum, define how `variant` maps to CSS classes, and how VS Code theme variables are consumed per component. Without this, two implementers would produce visually different results.

2. **MA-11** (Major, partial): Explicitly name the test framework. One line in §9 — "Tests use **Jest** with **@testing-library/preact** and **happy-dom**" — eliminates all ambiguity.

3. **M-08** (Minor): Add test file entries for Chat, Approvals, Memory, and Settings tabs in the §9.1 test structure.

### Can fix during implementation:

4. **M-01**: Replace SC-010 subjective metric with measurable behavior (e.g., "80% of chat interactions initiated from dashboard").
5. **M-02**: Add a paragraph defining when users should use `@aether` vs. dashboard Chat tab.
6. **M-03**: Replace `any` with `unknown` or specific types in `WebviewRequest.params`, `Task.result`, `StoreSyncManager` methods.
7. **M-09**: Update §3.4 L332 from "~180-210KB total" to "~180-210KB webview bundle" to match §11.1 clarification.
8. **NEW-01**: Delete the first (stale) §10.3 block at Lines 1706-1713.
9. **NEW-02**: Delete the duplicate §13.3 header at Line 1950 or 1952.

---

## Verdict

### ✅ APPROVED WITH CONDITIONS

**Score: 92/100**

The revised specification has been transformed from a document with critical blockers into an implementation-ready reference. All 4 critical issues are fully resolved, 10 of 13 major issues are resolved, and the spec now provides complete type definitions for all RPC methods, all UI components, all Zustand stores, and a full migration plan with file-level mappings.

**Conditions for unconditional approval** (can be addressed during Phase 1):

1. Add minimal component styling spec for `variant` → CSS mapping (MA-05)
2. Explicitly name the test framework (MA-11)
3. Fix 2 duplicate section headers (NEW-01, NEW-02)

**The implementation can begin immediately.** The remaining gaps are low-risk and do not block any phase of work.

---

_Re-review generated by SDD Specification Compliance Auditor_  
_Methodology: Finding-by-finding verification against Round 1 review, followed by new issue scan_
