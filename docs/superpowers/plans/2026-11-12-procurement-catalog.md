# Procurement catalogue implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. No commits or deployment are authorized.

**Goal:** Form stock positions from the reviewed purchase catalogue and prepare supplier orders in CRM.

**Architecture:** Private Firestore catalogue and orders behind a manager/financial callable API. Existing material ledgers remain authoritative; catalogue conversion creates an uncounted stock item or links an existing one.

**Tech Stack:** React, TypeScript, Firebase callable transactions, existing SheetJS Excel export.

**Spec:** `docs/superpowers/specs/2026-11-12-procurement-catalog-design.md`

## Global constraints

- Preserve unrelated telemetry changes. Work in the current checkout.
- Keep historical prices outside public web assets and Git-tracked seed data.
- No automatic cashflow changes, receipts, commits, push or deployment.
- Keep null distinct from known zero; validate money as integer minor units.

## Review focus

Malicious links; missing/fractional quantities; duplicate imports and retries; concurrent draft edits; unknown initial stock; partial deliveries.

## Tasks

- [x] Add failing tests for procurement calculations, safe import validation and stock confirmation rules.
- [x] Implement `web/src/features/procurement/procurementLogic.ts`, shared procurement types, and `functions/src/procurementLogic.ts` with validation and deterministic material IDs.
- [x] Implement `functions/src/procurement.ts`: authorized import, versioned order save and stock linkage; expose in `functions/src/index.ts`; protect collections in `firestore.rules`.
- [x] Extend material stock confirmation: `resources.ts`, `repairResources.ts`, inventory display/export and resource material picker. Existing manually created items retain prior behaviour.
- [x] Add `web/src/shared/firebase/procurement.ts`, `ProcurementWorkspace.tsx`, supplier order editor, stock-link form, Excel export, and scoped styles; integrate in `MaterialsTab.tsx`.
- [x] Generate the local private import file from the reviewed catalogue with all source references and product thumbnails. Verify 1 257 catalogue rows and 1 323 source rows remain.
- [x] Run targeted tests, both typechecks/builds and relevant regression tests; preview actual React views locally with demo adapters; inspect desktop/mobile and review the final diff.
