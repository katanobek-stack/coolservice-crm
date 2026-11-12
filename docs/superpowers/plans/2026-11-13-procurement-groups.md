# Procurement groups implementation plan

> Execute inline with superpowers:executing-plans. The user approved the design and implementation; no additional planning approval is needed.

**Goal:** Sort catalogue cards into editable groups, rename cards and use a recoverable basket.
**Architecture:** Existing callable adds versioned group and catalogue mutations; private group collection. A dedicated catalogue component owns sorting selection independently of the order draft.
**Tech Stack:** Existing React, TypeScript, Firebase and Node tests.
**Spec:** docs/superpowers/specs/2026-11-13-procurement-groups-design.md

## Constraints and review focus

Preserve unrelated telemetry changes and private imports. Reuse current suitable checkout. Do not change stock, historical orders or DDS. Each batch is at most 100 cards and atomic; deleted groups use tombstones so all member cards become ungrouped without bulk rewrites. Protect rename/delete/move races by category revision. Basket entries remain recoverable and imports never overwrite them. Selection clears on filter/search/page changes. Publish the approved CRM continuation under the user’s earlier explicit authorization for Git push and deployment; preserve all unrelated changes.

## Tasks

- [x] Backend: add tests in functions/tests/procurement.actions.test.js for defaults, duplicate/repeated initialization, rename/move/basket/restore, stale revisions, nonempty group deletion, archived item order edits; run to confirm failure. Add actions in functions/src/procurement.ts, focused functions/src/procurementCatalog.ts and validation; keep existing order compatibility. Protect procurementGroups in firestore.rules.
- [x] Frontend logic: extend procurement types and subscription; add functions to features/procurement/catalogLogic.ts for view filters/counts and group defaults. Test trash/ungrouped/missing-category and renamed search via web/tests/procurement.test.ts, verify failure then implementation.
- [x] UI: add ProcurementCatalog.tsx and catalogue dialogs; left group navigation and selection toolbar, card rename, photo enlargement, group add/rename/delete, basket restore. Replace previous inline catalogue in ProcurementWorkspace; preserve order selection and persisted draft. Extend preview fixtures for local isolated mutations.
- [x] Verification: both builds/typecheck and existing unit suites, actual UI desktop/mobile, sort/rename/delete/recover, independent order selection, group removal, role access; independent final review and fixes. Update docs/materials-and-reworks.md.

Ruling: retain deleted-group identifiers as tombstones; resolve membership through active groups — avoids partial migrations and concurrent move races. Verification ledger: backend additions first failed as unknown actions, then passed; frontend grouping test first failed module resolution, then passed; full UI smoke passed desktop/mobile, sorting selection independence, rename, basket/restore and nonempty category removal.

Verification: web typecheck/build and 262 unit tests pass; functions build and 15 procurement/resource tests pass. Independent review reported no P1/P2 issues. Actual React UI desktop/mobile smoke passed the full grouping workflow. Emulator-only rules verification runs in GitHub CI.
