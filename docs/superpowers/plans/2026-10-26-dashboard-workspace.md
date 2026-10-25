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
- [ ] Write and run failing behavioral tests for cases above, readiness and localized amounts.
- [ ] Implement selectors, typed role checks and readiness updates; keep financial helpers unchanged.
- [ ] Verify targeted tests.

### Task 2: Overview and compatible analytics/team sections
Files: stats/DashboardOverview.tsx, StatsTab.tsx, stats/dashboard.css.
- [ ] Add SSR permission/empty/loading tests and observe required failures.
- [ ] Implement search, scope/status filters, client/intake rows, today's appointments, monitoring and quick actions.
- [ ] Integrate PPZ-style navigation; preserve reports, protect all financial surfaces, keyboard-enable monthly details and request rows.
- [ ] Verify typecheck, unit suite and build.

### Task 3: Review, browser and publishing
- [ ] Fresh-context code review of the complete change.
- [ ] Full web emulator suite; inspect actual UI components on synthetic desktop/mobile preview.
- [ ] Publish through the existing workflow, verify CI/deployment, remove temporary QA pages and record limitations.
