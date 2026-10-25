# Dashboard Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the dashboard into an actionable service overview while preserving analytical reports and PPZ design.
**Architecture:** Typed selectors over existing authorized snapshots; a presentational overview; existing analytics and team panels; per-source loading/error state.
**Tech Stack:** React/TypeScript, CSS, Firebase; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-26-dashboard-workspace-design.md

## Global Constraints
- Preserve existing role permissions, data, backend and reporting helpers.
- No production test records, notifications, invented financial values or 320/390 checks.
- Use historical fixed-cost snapshots for current/previous revenue consistently.

## Review Focus
- Intake moved to a client must not appear twice or inflate financial totals.
- Finance-hidden administrators must not receive prices, chart geometry or month dialogs.
- Repeated snapshots must not mark unrelated streams loaded; errors must not look like zero.
- Task-complete repairs awaiting manager closure must remain visible as ready to close.
- A UTC day/month boundary must not change service-day metrics away from Vladivostok.

### Task 1: Typed operational selectors and source readiness
Files: stats/dashboardLogic.ts, shared/context/dataReadiness.ts, DataContext.tsx, tests/dashboard.test.ts, package.json.
- [x] Write and run failing behavioral tests for cases above, readiness and localized amounts.
- [x] Implement selectors, typed role checks and readiness updates; keep financial helpers unchanged.
- [x] Verify targeted tests.

### Task 2: Overview and compatible analytics/team sections
Files: stats/DashboardOverview.tsx, StatsTab.tsx, stats/dashboard.css.
- [x] Add SSR permission/empty/loading tests and observe required failures.
- [x] Implement search, scope/status filters, client/intake rows, today's appointments, monitoring and quick actions.
- [x] Integrate PPZ-style navigation; preserve reports, protect all financial surfaces, keyboard-enable monthly details and request rows.
- [x] Verify typecheck, unit suite and build.

### Task 3: Review, browser and publishing
- [x] Fresh-context code review of the complete change.
- [x] Full web emulator suite; inspect actual UI components on synthetic desktop/mobile preview.
- [x] Publish through the existing workflow, verify CI/deployment, remove temporary QA pages and record limitations.

## Verification record
- TypeScript application and tests: passed. Production Vite build: passed (existing bundle-size advisory remains).
- Unit tests: 121 passed, including 11 dashboard checks. Red-to-green tests covered selectors, readiness, hidden amounts, source errors, legacy appointments and completion/closure labels.
- Full web emulator suite: 221 checks passed before two additional SSR/status regressions; the final unit run includes both. No backend or Firestore rules changed.
- Independent fresh-context review found legacy missing assignees and an ambiguous closure label. Both fixed and reviewed again with no remaining findings.
- Browser/CI/deployment evidence will be recorded after publication below.

- Production component browser QA on explicitly synthetic data: desktop screenshot saved; search, callback, personal scope, mobile unassigned filter, hidden money and source failure verified. Mobile document width/scrollWidth: 480/480, no horizontal overflow. No 320/390 checks.
- First GitHub Pages deployment ccff54b succeeded. Temporary QA pages removed in the verification follow-up commit. Final deployment/CI statuses checked through GitHub Actions.
- Limitation: production app requires sign-in; authenticated live data interactions were not performed. Analytical panels verified by typecheck/unit tests/code review, not by a logged-in browser session.
