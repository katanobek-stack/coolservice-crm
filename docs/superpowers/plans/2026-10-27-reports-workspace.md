# Reports Workspace Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; one fresh final review.

**Goal:** A professional reports/closing workspace with preserved data and safer manager actions.
**Architecture:** Pure report selectors + shared closure validator; existing detailed cards and export preserved under a new scoped workspace.
**Tech Stack:** React, TypeScript, existing Firebase transactions/CSS/XLSX.
**Spec:** docs/superpowers/specs/2026-10-27-reports-workspace-design.md

## Global Constraints
No real QA writes; no dependencies/schema/rules changes; keep financial month and report/photo semantics; desktop/480, never320/390.

## Review Focus
- Task completion changes after the manager opens a card must reject close without overwriting tasks.
- Blank/negative/infinite/malformed money must not close, zero remains allowed.
- Chamber-only intake and legacy closedAt records must be classified correctly.
- Failed writes/read-source errors must preserve drafts and release busy state.
- Export must obey amount permissions/readiness and not silently export an unavailable month.

### Task 1 — closing and selectors
- [x] Red tests in web/tests/reportsWorkspace.test.ts: amount grammar, fresh-state conflicts, closure state, chamber intake, multiword search/employee/kind/month and archive statuses.
- [x] Implement shared/utils/repairClosure.ts and features/done/reportsLogic.ts. Existing transaction invokes close helper; optional requireReady flag safeguards reports intake assignment without changing older callers.
- [x] Unit green and focused emulator regression for intake requireReady.

### Task 2 — workspace and close review
- [x] Implement ReportsWorkspace.tsx + reports.css and integrate DoneTab.tsx. Tabs, counters, common filters and queue disclosure retain existing task/photo/archive components.
- [x] Guard source readiness/export, retain drafts in hidden mounted views, error/finally on close/task return/archive return/freon correction.
- [x] Close review clearly names object/client/amount and does not imply payment. Unit/SSR red-green, typecheck/build, full web emulator suite.

### Task 3 — review and release
- [x] Fresh review, regression fixes, actual-component synthetic browser QA desktop/480.
- [x] Publish implementation and browser fixes with a lease on observed main; CI and Pages passed for 43b1803. Remove synthetic QA pages in the final cleanup commit and verify its deployment.

## Ledger
- Base30294ee includes newer warehouse work from another session; preserved by branching from current origin/main. User requests same delegated workflow and has standing commit/publish authorization.
- Legacy intake assignment tests deliberately close newly created unfinished repairs; requireReady will be opt-in only for Reports, preserving other API callers while guarding this screen.

- Independent review: fixed Important live-prop review baseline loss by capturing reviewed repair/intake; fixed portal visibility using ReportModalBody retaining hidden editor inputs; fixed cleared-list draft loss by rendering last confirmed data while source is blocked. Each is covered by a failing regression before implementation, followed by177 green unit/SSR checks.
- Also fixed task-only archive month selection. Existing shared modal focus trapping/Escape/restoration remains a pre-existing accessibility follow-up; Reports adds native queue disclosures and native archive-detail buttons.
- Typecheck and build pass. Full emulator web suite282 checks (177unit,2indexes,44rules,26appointments,18concurrency,15intake) exits0. Real transaction tests confirm stale review rejection and successful fresh close, including intake atomic move. Existing unrelated warehouse/navigation work preserved.

- Final regression evidence: 181 unit/SSR tests pass, typecheck and production build pass. Focused final emulator rerun: 18 concurrency and 15 intake tests pass. CI and Pages for 43b1803 completed successfully.
- Browser checks on actual components with fictional records and all real writes blocked: multiword search; intake including chambers; exact 12 500,50 RUB close review; mechanic work report; stale-review conflict; amount and new-client drafts survive cleared read sources; owner edit portal blocks while unavailable and restores its draft; admin amount permissions and mechanic view-only controls; task-only archive month; real monthly Excel download with correct repair sum and three sheets. 480px iframe body width and scroll width both 480px.
- Browser fixes: preserve cents in final review, include mechanic work comments and repair photos, reject stale review when repair-level photos change. Added failing regression tests before changes.
- Limits: live authenticated production workflows were not exercised; no production records were created or edited. The pre-existing shared-modal focus trap/Escape/focus restoration follow-up remains outside this scoped change.
