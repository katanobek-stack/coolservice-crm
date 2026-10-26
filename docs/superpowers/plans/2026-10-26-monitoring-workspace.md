# Monitoring Workspace Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans; fresh final review required.

**Goal:** Colorful, reliable and extensible monitoring UI without altering persisted data or telemetry protocols.
**Architecture:** Pure workspace status/selectors, presentational overview, existing detail/chart/rule components with scoped listener state. Scoped new CSS preserves global alert center.
**Tech Stack:** Existing React/TypeScript/CSS/Firebase; no dependencies.
**Spec:** docs/superpowers/specs/2026-10-26-monitoring-workspace-design.md

## Global Constraints
Same collections/IDs/history/rules/APIs/roles. No production QA writes or notifications. No backend/security rules changes. Desktop/480; never320/390. Healthy connectivity must never imply safe temperature.

## Review Focus
- Heartbeat and measurement delivery may disagree; all UI must use heartbeat for connection and timestamp/finite value for reading freshness.
- Disabled devices/test/unassigned records remain visible in filters, with honest independent counts.
- Previous device/period sensor state, rules and histories must not flash or write under a newly selected device.
- Listener failures/settings not ready must not produce green healthy counters or false no-sensor messages.
- Existing per-sensor chart boundaries, legacy fallback, historical quality styles and role guards remain intact.

### Task 1: Workspace logic and ownership
Files: monitoring/workspaceLogic.ts, tests/monitoringWorkspace.test.ts, package.json.
- [x] Write failing tests for status/filter/sort/count/source/owner cases.
- [x] Implement pure row selector, stats, source gate and selected sensor view; verify green.

### Task 2: Colorful overview and scoped details
Files: MonitoringOverview.tsx, MonitoringTab.tsx, monitoring-workspace.css.
- [x] Write SSR readiness/color/role tests and observe failure; implement overview.
- [x] Integrate filters, grouped status counters/settings and remove background miniature history subscriptions.
- [x] Gate selected sensor/rule/history state with device/period ownership and abandoned-callback guards. Retain actual chart and editing components in separate detail views.
- [x] Stable sensor colors, Vladivostok display, proper loading/error states; typecheck/unit/build.

### Task 3: Review and publish
- [ ] Fresh review and regression fixes.
- [ ] Full web emulator suite; synthetic actual-route browser QA desktop/480.
- [ ] Commit/PR/publish, verify CI/deploy, remove QA pages and record limitations.

## Verification record
- Baseline 144 unit checks; final 157 unit/SSR checks pass, including 13 new monitoring cases. Behavioral red/green evidence covers heartbeat/delivery divergence, stale/invalid readings, enabled/disabled alarm counts, search/sort/bindings, source readiness and selected sensor ownership/legacy fallback.
- Independent review found filter-state loss on Back, long-period timezone inconsistency and draft unmount on source failure. Each was covered by a failing regression test, fixed and the unit suite rerun green. Filters live in the controller parent; all axes use Vladivostok; a persistent source boundary retains drafts while hiding unconfirmed content. Rename dialog stays mounted and blocked during source failure.
- Sensor/rule/history source errors clear per-source on successful recovery; abandoned callbacks are ignored. Registry and state readiness are independent.
- TypeScript and Vite production build pass; existing bundle-size advisory remains. Full Firestore emulator suite passes 259 checks (157 unit,2 indexes,44 rules,26 appointments,17 concurrency,13 intake), script exits0.
- Overview no longer opens per-device miniature history subscriptions. Full per-sensor chart periods, quality markers, zoom/navigation and rule-target filtering remain in selected-controller details.
- No backend, Firestore rules, protocol, collection/ID or dependency changes; no production records, settings or notifications touched for QA.
