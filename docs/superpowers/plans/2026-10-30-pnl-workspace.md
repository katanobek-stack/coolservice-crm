# P&L Workspace Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; one fresh whole-branch reviewer.

**Goal:** Consistent month-based income/expense workspace with preserved records and safe forms.
**Architecture:** Pure pnlLogic selectors/export rows, transaction wrappers for financial operations, scoped PnlTab and CSS.
**Tech Stack:** Existing React/TS/Firebase/XLSX, no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-30-pnl-workspace-design.md

## Global Constraints
Keep financial-month and completed-repair semantics; historical fixed snapshots; existing backend roles; no production QA writes. Desktop/480, never320/390. Existing authorization covers inline implementation and publishing.

## Review Focus
- Read failure clearing finance/expenses must hide unconfirmed totals and preserve all drafts.
- Editing a field while another employee updates it must not overwrite the fresh value.
- A retry after an uncertain save must not create a second purchase/commission.
- Historical periods without full snapshots must disclose fallback and never show current itemisation as historical fact.
- Journal filters and view selection must not silently change summary/export scope.

### Task 1 — month calculations and safe writes
Files: features/pnl/pnlLogic.ts, shared/firebase/pnl.ts, tests/pnlWorkspace.test.ts, tests/firestore.concurrency.test.ts, package.json.
Interfaces: buildPnlMonth(data,month), pnlMonths(data,current), selectPnlJournal(rows,filters), pnlExportRows(month), parsePnlAmount(value,positive); savePnlElectricity(month,amount,expected,db?), addPnlCommission(entry,db?), removePnlPurchase(expected,db?).
- [x] Write/run failing tests for month attribution, fractional money, snapshot fallback, all-period discovery, search/category and export scope.
- [x] Implement pure logic preserving repairStatus and resolveFixedCosts; add guarded electricity/purchase removal and idempotent commission writes.
- [x] Add/run emulator tests for stale bill, concurrent purchase preservation/removal and commission retry/role denial. Run unit suite.

### Task 2 — workspace and forms
Files: features/pnl/PnlTab.tsx, PnlSettings.tsx, pnl.css.
Interfaces: pure month data from Task1, PnlSettings captures finance at editor opening, source readiness blocks all writes.
- [x] Add SSR regression for loading/error/permission visibility, historical disclosure and loss/empty state.
- [x] Build period toolbar, three coloured totals, formula bridge, month table, expense journal, revenue details and inline settings editor.
- [x] Explicit dated forms, validation, pending locks, recoverable errors, deletion review and export. Run unit/typecheck/build.

### Task 3 — review and release
- [x] Fresh whole-branch review and one RED/GREEN fix pass for important findings.
- [x] Actual-component synthetic browser QA desktop/480: period consistency, filters, forms, draft recovery, export and settings.
- [x] Publish with lease on current main, verify CI/Pages, remove QA pages, verify actual login/assets. Record evidence/limits.

## Ledger
- Clean base dd99afd, baseline181 unit tests pass. Dedicated branch codex/pnl-workspace in existing session checkout; preserve unrelated work.
- Pre-flight: Task2 consumes Task1 month data and write wrappers; dates/months remain explicit, journal filter scope never enters buildPnlMonth. No interface conflict.

- Independent review: no critical findings. Fixed both important workflows: a new completed operation starts in the selected period while an unfinished draft retains its period; edited uncertain retries keep one ID and transactional addPnlPurchase rejects a changed committed payload instead of duplicating it. Three unit regressions failed before the fix; a new emulator regression failed before purchase implementation.
- Export fallback finding regraded Important: a standalone financial workbook must identify actual current-value fields, without needing the app. Export now lists precise fallback fields; regression RED→GREEN. Pending bill replacement was already guarded by billLock when review ran; disabled button added for visible feedback. No deferred findings.
- Baseline and completed-repair revenue rules intentionally retained. This may differ from payment or manager-closed-only reporting; the screen and workbook label that basis explicitly. No changes to financial source data or backend role permissions.

- Verification: 196 unit/SSR + 2 index + 44 rules + 26 appointment + 23 concurrency + 15 intake checks = 306 checks, all passed in the final full Firestore emulator run (/workspace/scratch/pnl-emulator-final.log), exit0. Typecheck and production build passed. CI/Pages for 703893d both completed successfully.
- Synthetic browser evidence: September and October amounts/rows follow the selected period; draft date2026-09-01 and amount7777,25 survive changing report month, emptying sources and restoring them; blocked purchase save retains fields and releases button; fresh-bill conflict retains14000,25 while actual bill changes19000; failed deletion retains exact target; settings27000,25 survives failure/recovery; admin explicit panel=false and mechanic both show no financial data.
- Actual browser Excel download verified numeric result98800.50 with three operation rows and two repair rows even while the journal displays only one filtered commission. Workbook sheets P&L/Операции/Ремонты.
- Mobile browser found a real flex-root overflow: body480, scroll580. Added width100% and min-width0 boundaries so only the monthly table scrolls; browser GREEN verified after ee253a5: body480/scroll480 in overview and journal, formwidth404 inside480 frame. Child-frame URL was versioned only to refresh its independent browser cache. This visual regression does not change financial logic.
- Limits: no authenticated production financial writes or account mutations; all browser records are fictional and Firebase writes are blocked. Existing production login and exact deployed assets are verified separately. No database migrations or schema/rules changes.

- Release cleanup removes both temporary preview HTMLs. No runtime QA routes remain. Final production source CSS index-bOLpDfvD.css; production app remains authenticated and no live writes were attempted.
