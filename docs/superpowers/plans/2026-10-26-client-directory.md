# Client Directory Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; fresh whole-branch code review at completion.

**Goal:** A grouped sortable client directory and structured profile that retain existing CRM data and work flows.
**Architecture:** Pure directory selectors, a presentational ClientDirectory, scoped CSS and integration in ClientsTab. Existing forms/mutation APIs remain the persistence boundary; Modal accepts an optional class for the larger profile.
**Tech Stack:** Current React/TypeScript/CSS/Firebase, no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-26-client-directory-design.md

## Global Constraints
Same records/IDs/roles, no backend/rules/migrations or real QA writes. Current Manrope/PPZ palette. Never test320/390; desktop and480 only.

## Review Focus
- Legal prefix sorting changes display ordering only; legacy type/name fields remain searchable.
- Cancelled/closed/reopened/ready repairs produce honest counts; no guessed finances or deadlines.
- Filters/search/grouping/paging must preserve every matching client and never mutate source records.
- Async deep links wait for clients; selected profile reflects live records and never resurrects a deleted record.
- Profile sections must retain existing actions, photographs, legacy appointments, conversion history and role guards.

### Task 1: Directory logic
Files: features/clients/directoryLogic.ts, tests/clientDirectory.test.ts, package.json.
Interfaces: summarizeClients(clients):ClientSummary[]; selectClientDirectory(summaries,filters):ClientSummary[]; groupClientDirectory(rows,group):ClientGroup[]. Filters type/search/activity/equipment/sort.
- [x] Write behavior tests and observe failures.
- [x] Implement typed pure selectors, deterministic grouping/sorting and safe dates; verify green.

### Task 2: Directory/profile UI
Files: ClientDirectory.tsx, clients.css, ClientsTab.tsx, shared/ui/Modal.tsx.
- [x] Write SSR layout/error tests, observe failures, implement directory.
- [x] Integrate grid/table, visible group headings, search/filter/reset and result counts. Keep type route selection and live/deep-linked profiles.
- [x] Structure profile into overview/equipment/work/history/appointments, keep child components/editors and role policies intact. Improve touched form error feedback.
- [x] Run typecheck, unit tests, build and inspect diff.

### Task 3: Delivery
- [x] Fresh review, test/fix concrete regressions.
- [x] Full Firestore emulator suite, synthetic browser desktop/480 checks of real components.
- [x] Authorized commit/PR/publish, verify CI/deploy, remove temporary QA pages and record limitations.

## Verification record
- 144 unit/SSR tests passed, including 12 directory checks. Tests were observed failing before selectors/disclosure/source-state/deep-link implementations.
- Full Firestore emulator suite: 246 checks passed (144 unit, 2 indexes, 44 rules, 26 appointments, 17 concurrency, 13 intake); script exited 0.
- Fresh independent review found plate queries being stripped into phone digits. Reproduced in a failing regression test, restricted phone fallback to phone-like tokens, final suite green. No other concrete findings.
- Existing profile sections, mutation APIs and role/amount policies are retained; ready work is shown in Work, confirmed closure/cancel in History, using the same request-stage helper as the requests screen.
- Deep links wait for confirmed client snapshots and retain vehicle ids locally before acknowledging AppShell navigation. Deleted clients are never rendered from cached selection snapshots.
- No schema/backend/rules/dependency changes, production records or notifications. Optional Modal className changes only the new profile width.

## Browser and delivery evidence
- First GitHub Pages deployment e42d036 succeeded. Actual ClientsTab/ClientDirectory/profile components ran against synthetic providers and Firebase accessors that throw before any write. No real client records were read or changed for UI QA.
- Desktop: default letter groups and grid inspected; show-more expanded 24 to all 31 matching clients; Latin plate query selected the expected record; compact company table sorted Айсберг, Бриз, Восток, Дальневосточная доставка, Рыбный порт, Северная логистика.
- Profile: Overview/Equipment/History/Appointments sections inspected. New and legacy appointments both appear (2 expected). Pending deep link opened only after source readiness; direct vehicle link opened the correct vehicle history. Removing the selected synthetic client from its provider closed the stale profile.
- Blocked create-company write retained its entered name and displayed explicit error. Mechanic saw no create action; source error hid stale records and rendered an alert.
- Mobile width480: directory document480/scrollWidth480; table kept horizontal scrolling inside its own region (446/760), no page overflow; profile478/scrollWidth478 with five panels; mobile equipment view visually inspected. Never checked320/390.
- Screenshots explicitly contain synthetic data. Temporary QA pages removed in verification follow-up. Production app login and final deployment checked separately; no authenticated production write workflow was tested.
