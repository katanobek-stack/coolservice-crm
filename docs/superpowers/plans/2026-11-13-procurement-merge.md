# Group-scoped catalogue comparison and merging

**Goal:** Suggest similar items only within the user's existing groups and let the user confirm one named item with all purchasing links and source history.
**Architecture:** Client-side text/link/photo candidate detection, explicit merge dialog and transactional callable merge. Original cards become immutable merge records, existing orders retain original IDs and quotes. No automatic stock reconciliation.
**Spec:** docs/superpowers/specs/2026-11-13-procurement-merge-design.md, approved by the user with the added constraint to search only within existing groups.

## Constraints and rulings

Use the suitable current checkout; preserve unrelated telemetry edits, private imports, groups, stock and DDS. Continue the user's authorized Git push/deploy workflow after checks. Never automatically merge live cards. Match only equal nonempty active group IDs. Exclude ungrouped, trash and merged aliases from suggestions. Keep the chosen primary ID and group. Two different linked material IDs block merging. A single linked material may be renamed only with its separate explicit checkbox and revision check. Disabled supplier links are excluded from new orders but preserved in old orders. Reject oversized merges before any write. Retain original cards and a private audit record; block ordinary restore/mutation/link of absorbed cards.

## Tasks

- [x] Backend tests first: merge same-group cards, unique supplier/history preservation, group/material conflicts, revision checks, stock name only opt-in, no quantity/value writes, aliases cannot restore/reimport/new-order/link, old orders editable and disabled links historical compatibility. Implement focused functions/src/procurementMerge.ts, guard existing actions, supplier toggle, shared types/API/rules.
- [x] Candidate tests first: group isolation, exclusion of ungrouped/trash, same URL/photo/model reasons and uninformative names. Implement catalogueSimilarity.ts plus async photo fingerprints, with nonblocking progress and no external requests.
- [x] UI: candidate browser by existing group, comparison/merge dialog with primary name/photo/history, manual merge from sorting selection, read-only absorbed provenance, supplier availability controls. Preserve sort/order selections and browser presentation options. Add local preview adapters.
- [x] Actual current private catalogue: export read-only snapshot with current groups for useful preview and counts; do not publish data files or merge live records. Desktop/mobile smoke, web tests/typecheck/build, backend tests/build, independent code review and fixes.
- [ ] Publish only reviewed feature code/functions/rules and verify private access, live asset and GitHub CI. User reviews and confirms actual merges in CRM.

Verification ledger: new backend actions first failed as unknown actions, then passed. Group-isolation and explicit size/voltage tests observed failing before implementation/fix. Web typecheck/build and 268 unit tests pass; functions build and 20 procurement/resources tests pass. Actual React desktop/mobile smoke verifies screenshot pair, candidate group filtering, explicit confirmation, source union, two sellers, stock-name opt-in with unchanged quantity and an uncertain-response retry that commits once. Independent review P2 retry issue fixed by snapshotting group/material revisions; re-review found no remaining P1/P2. Live catalogue was only read for a private preview snapshot; no live card merges performed.
