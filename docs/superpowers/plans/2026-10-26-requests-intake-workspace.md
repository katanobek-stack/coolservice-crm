# Requests and Intake Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; fresh whole-change reviewer at the end.

**Goal:** Professional request/intake workspaces matching PPZ without changing persisted data.
**Architecture:** Pure view selectors plus shared presentational workspace/card components, integrated with existing transactional work editors and forms.
**Tech Stack:** Existing React/TypeScript/CSS/Firebase; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-26-requests-intake-design.md

## Global Constraints
- Same collections/IDs, no migration/backend/rules changes or production QA writes.
- Mechanics retain existing assigned-active repair-task visibility; intake retains existing authenticated staff controls.
- Preserve comments/photos/task completion/client navigation and manager closure in Отчёты.
- Existing PPZ palette/Manrope; desktop/480 QA, never 320/390.

## Review Focus
- Cancelled/confirmed closed objects cannot inflate active/ready counts.
- Completed tasks and manager closure are distinct; service task all-assignee semantics remain unchanged.
- Legacy missing arrays, vehicle kinds, dates and unknown historical staff remain usable.
- Scope/search/status/type filters combine without mutating/reordering source arrays.
- Request UI changes must not alter transactional writes, drop form fields or hide source failures as emptiness.

### Task 1: Selectors and behavioral verification
Files: shared/requests/workspaceLogic.ts; tests/requestsWorkspace.test.ts; package.json.
Interfaces: selectClientRequests(clients, scope) returns {client,repair,tasks}[]; selectIntakeRequests(intake, scope) returns IntakeRepair[]; selectServiceRequests(tasks,scope) returns ServiceTask[]. Scope includes uid, manager, search, employee, mine, status, sort, kind, staff.
- [x] Write tests for five review cases, observe failures with missing implementation.
- [x] Implement pure selectors; verify targeted tests green.

### Task 2: Shared presentation and real-route integration
Files: shared/requests/RequestWorkspace.tsx, workspace.css; features/mytasks/MyTasksTab.tsx; features/intake/IntakeTab.tsx.
Interfaces: shared workspace header, filters, source feedback and RequestCard with native disclosure/children, all persistence stays in existing route components.
- [x] Add SSR disclosure/error tests, observe failures, implement components.
- [x] Replace long outer lists with filterable views and compact cards; preserve existing editors/actions/photos/forms.
- [x] Make standalone creation/subtask errors recoverable and omit undefined fields in service task creation; preserve write API contracts.
- [x] Typecheck, unit tests, production build and diff review.

### Task 3: Verification and delivery
- [ ] Fresh whole-diff review and resolve concrete regressions.
- [ ] Full web emulator suite, synthetic browser preview with actual components desktop and 480.
- [ ] Commit/push/publish, verify CI/deploy, remove QA pages, record limitations.

## Verification and decisions
- Baseline: 121 unit tests passed on c9cbec3.
- Selector/SSR red-to-green: first 6 behavior tests, then 2 disclosure/error tests. Final unit run 132/132, including 10 request-workspace and one dashboard reopening regression.
- TypeScript and production build passed; existing Vite bundle-size advisory remains. No dependencies added.
- Fresh review found omitted intake chamber label search and historical closedAt overriding explicit reopening. Both reproduced by failing tests and fixed. The same small reopening correction was applied to dashboardPhase so the service overview agrees with the queues.
- Existing Firebase mutation contracts and all-assignee service completion rules are unchanged. Intake's existing authenticated-worker management rights remain unchanged. Explicit historical staff ids are retained in filter options.
- Creation input is retained on errors, optional service fields omit undefined, subtask retries retain the same id. This does not promise idempotency for legacy addDoc/intake create APIs; those persistence contracts remain unchanged.
- UI preview bundles the actual route components with synthetic context and a Firebase accessor that throws before any network write. No credentials or real records are included.
