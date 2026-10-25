# PPZ Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make shared PPZ tasks and daily plans usable in a compact, clear workspace with safe retries.
**Architecture:** Retain Firestore read permissions and all callable endpoints; derive filters locally, preserve mounted forms, disclose task details with native HTML.
**Tech Stack:** Existing React, TypeScript, Firebase and CSS; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-26-ppz-workspace-design.md

## Global Constraints
- Preserve all shared-completion, personal-report, role and publication semantics.
- Do not add deadlines to shared tasks, migrate records, or change backend/rules.
- Preserve edits on failed save, filters and workspace navigation; no 320/390 checks.

## Review Focus
- Retry after lost create response must not duplicate tasks.
- Filters must include legacy records without author/name/time snapshots.
- Filtering a task must not discard an in-progress report.
- Mechanic/manager UI must not expose administrator controls or widen reads.
- Day-plan draft conflict and publish/notification behavior must remain intact.

### Task 1: Search/filter and retry behavior
Files: web/src/features/daily-plan/presentation.ts; web/tests/dailyPlan.test.ts.
- [x] Add failing tests for combined filters, counts, legacy fallback names, stable retry IDs and changed-input requests.
- [x] Run targeted bundled dailyPlan test and observe failure.
- [x] Implement typed pure selectors and normalized create-request reuse.
- [x] Run tests and verify pass.

### Task 2: Shared-task workspace
Files: PpzTasks.tsx; dailyPlan.css; web/tests/ppzPhotos.test.ts.
- [x] Add semantic render assertions for collapsed native details and grouped task actions, retaining all existing role tests.
- [x] Implement task header, search/status/employee controls, counts, optional creation form and success/error feedback.
- [x] Reuse request IDs on failed creates and retain task components when hidden by filters.
- [x] Group task details; confirm global completion; preserve photos, dictation and contribution history.
- [x] Verify tests and typecheck.

### Task 3: Daily-plan navigation and final verification
Files: DailyPlanTab.tsx; dailyPlan.css; AppShell.tsx label metadata.
- [x] Add workspace navigation while keeping editors mounted; retain original daily-plan content and permissions.
- [x] Apply cohesive responsive styles scoped to PPZ.
- [x] Run web unit suite, typecheck, build and available emulator checks; report limitations accurately.
- [x] Review diff and rendered demo/desktop/mobile behavior. Publish only the intended frontend change through the established workflow and verify deployment status.
