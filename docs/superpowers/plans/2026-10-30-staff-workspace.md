# Staff workspace implementation plan

**Goal:** Refresh Personnel in the existing CRM design language with search, role/activity filters, monthly results, drill-down and reliable profile/access editing.

**Architecture:** Pure staffLogic derives directory rows and monthly closed-repair attribution. StaffWorkspace renders supplied data without Firebase. StaffTab connects existing auth/data contexts; StaffEditor saves atomic field updates using the existing conflict-aware transaction helper.

**Constraints:** User delegated additions and implementation choices. Reuse current clean codex/crm-current-workspace checkout. No commits, push, deployment, role grants, deletion, new dependencies or schema changes. Existing owner/admin/self rules remain authoritative. Financial figures respect reports_amounts. Business date is Asia/Vladivostok. Equal attribution is repair revenue, never salary or individual earned income.

**Review focus:** Open repairs must not enter revenue; legacy assignments and decimal amounts remain valid; stale/error sources must not show confirmed totals; self role and owner role must stay locked; conflicts and failed saves retain form input.

### Task 1: Directory and monthly result derivation
- [x] Add staff.test.ts and run RED for closed-only attribution, cancellation, legacy assignments, deduplication, tied ranking, localized amounts, month boundary, filters and missing data.
- [x] Implement staffLogic.ts: buildStaffResults, selectStaff, staffEditPolicy, staffProfileChanges, staffMonth.
- [x] Run targeted tests GREEN.

### Task 2: Workspace and editing
- [x] Add rendering tests RED: loading/error protection, hidden finance, accessible filters, self/owner policy.
- [x] Build StaffWorkspace.tsx, StaffEditor.tsx, staff.css and replace StaffTab.tsx wiring. Include explicit save, role-change review, permission explanations, retryable errors and in-flight close guard. Save only changed name/role/permissions with optimistic conflict checking, never overwrite email.
- [x] Integrate staff test into existing unit test scripts.
- [x] Run typecheck, complete test command, production build and inspect responsive demo using synthetic data.

## Progress
- Planning: inspected auth, staff rules, existing UI, financial dates and concurrency helpers. User opted to delegate feature choices; proceed without further design questions.

- Task 1: complete. Eleven targeted logic/rendering tests pass; current-month boundary and timestamp closure regression both verified.
- Task 2: complete. Profile writes reuse existing transactions; two new emulator cases verify email preservation and stale name/permission conflict rejection. Keyboard and responsive UI tested at 390 and 1280 pixels with synthetic data.
- Review: independent reviewer found UTC close-date attribution issue (fixed with RED/GREEN regression) and header-close focus reachability issue (reproduced and fixed, verified keyboard wrap across the complete modal).
- Final checks: typecheck and production build passed. Full emulator suite passed 281/281 tests, zero skipped/cancelled. Existing bundle-size warning remains. No production records changed; no commits/push/deployment. Temporary demo removed.

## Authorized release follow-up
User requested synchronization, commit, push and deployment. Merged origin/main at 75cf92b (seven reports/P&L release commits); resolved package.json by retaining all three feature test suites. Reports/P&L production code is unchanged from origin/main. Combined version passed typecheck, build and all 319 emulator/unit/index tests, with zero failures/cancellations/skips. Reviewed split/map calls in the staff implementation and incoming financial/report derivations for defined collections/strings. Publication uses the existing main-branch GitHub Pages workflow; no Functions or Firestore rules changes are required.
