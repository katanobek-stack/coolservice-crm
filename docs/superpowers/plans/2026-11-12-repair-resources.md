# Materials, time and rework Implementation Plan

> **For agentic workers:** Use executing-plans and dispatching-parallel-agents. Do not touch unrelated telemetry changes. User authorized implementation; no procurement module or automatic DDS writes.

**Goal:** Manual material/time capture inside repairs, gradual material inventory with low-stock alerts, linked rework and cost analytics.

**Architecture:** Public catalog/repair resource records, separate financial valuations/rates/cost snapshots. Trusted callable transactions validate repair/task, role, stock and idempotent request ID. Receipts, consumption and returns update stock and cost atomically. Resource records bind to repair ID and survive intake assignment. UI retains current light styling. Existing freezer warehouse stays separate. Repair completion date remains accounting basis; payment destination is metadata only for later DDS integration.

**Tech Stack:** React/TypeScript, Firebase callable Functions, Firestore, existing XLSX.

- [x] Pure numeric/cost functions and tests: scaled quantities, moving average, returns, missing rates.
- [x] Callable resources API and emulator tests: roles, idempotency, concurrent consumption, insufficient stock, time/rates, returns, frozen costs.
- [x] Materials page: receipts, minimums, alerts, cost rates, analytics, spreadsheet export, readiness/error states.
- [x] In-task resources/time forms, client and intake integration; immutable audit, correction by reversal.
- [x] Linked rework workflow: manager creates/confirms cause and responsibility, original/repairing staff separate, no automatic wage deductions. Payment destination metadata.
- [x] Navigation, Firestore rules, unit/integration/build/browser checks, independent review and release preparation.

**Verification:** web typecheck/build and functions build pass; 254 web unit tests, full existing web emulator suite including new read/write rules, 3 pure resource-cost tests and 10 callable integration tests passed. Browser scenarios exercised actual components with isolated mock data: material consumption, time, zero declarations, confirmation invalidation, returns, rework decisions, payment destinations, receipts, stock counts, rates, Excel readback and mobile layouts. Independent review findings were addressed: authoritative protected rework ledger, financial permission alignment, completeness confirmation, missing linked-child costs/responsibility retained. Some local CLI runs timed out during emulator shutdown after the tests exited successfully; final targeted callable run completed with CLI exit 0.

**Release:** publish `functions:manageRepairResources` and `firestore:rules` to coolservice-crm before updating main/GitHub Pages. No other functions, procurement workflows or DDS entries are part of this release. Unrelated telemetry edits remain outside the commit.

**Contract:** `web/src/shared/types/resources.ts`, API `web/src/shared/firebase/resources.ts`; amounts are integer cents, quantities integer thousandths of catalog units, time integer minutes. Catalog units pcs/kg/ml/m. No offline writes, negative stock, silent zero costs or automatic cashflow mutations.
