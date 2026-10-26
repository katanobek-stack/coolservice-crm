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
- [x] Fresh review and regression fixes.
- [x] Full web emulator suite; synthetic actual-route browser QA desktop/480.
- [x] Commit/PR/publish and remove QA pages; CI/deploy results checked through GitHub Actions.

## Verification record
- Baseline 144 unit checks; final 157 unit/SSR checks pass, including 13 new monitoring cases. Behavioral red/green evidence covers heartbeat/delivery divergence, stale/invalid readings, enabled/disabled alarm counts, search/sort/bindings, source readiness and selected sensor ownership/legacy fallback.
- Independent review found filter-state loss on Back, long-period timezone inconsistency and draft unmount on source failure. Each was covered by a failing regression test, fixed and the unit suite rerun green. Filters live in the controller parent; all axes use Vladivostok; a persistent source boundary retains drafts while hiding unconfirmed content. Rename dialog stays mounted and blocked during source failure.
- Sensor/rule/history source errors clear per-source on successful recovery; abandoned callbacks are ignored. Registry and state readiness are independent.
- TypeScript and Vite production build pass; existing bundle-size advisory remains. Full Firestore emulator suite passes 259 checks (157 unit,2 indexes,44 rules,26 appointments,17 concurrency,13 intake), script exits0.
- Overview no longer opens per-device miniature history subscriptions. Full per-sensor chart periods, quality markers, zoom/navigation and rule-target filtering remain in selected-controller details.
- No backend, Firestore rules, protocol, collection/ID or dependency changes; no production records, settings or notifications touched for QA.

- Browser QA uses the actual MonitoringTab bundled with synthetic providers/listeners and all writes blocked. Desktop and480 CSSpx verified: multiword client/plate search, disabled registry, Back retains filters, device switch displays loading without old sensor data, period/sensor selection, source failure hides unconfirmed counters, recovery retains rename and rule drafts, blocked save retains text, sensor-registry errors do not imply an empty registry, mechanic lacks management actions. History listeners:0 on overview,2 for two selected sensors,0 on Back. Overview/detail/graphs document width equals480 with no page overflow.
- Browser screenshots: coolservice-monitoring-1792989935965.jpg (overview), coolservice-monitoring-detail-1792990011605.jpg (controller), coolservice-monitoring-mobile-1792990032233.jpg (480 layout); all data explicitly fictional. Temporary monitoring-preview.html and monitoring-mobile-preview.html removed after QA.
- Production authentication is not available in this browser: authenticated real-controller/hardware workflows were not exercised. No production QA data/settings/notifications were written. CI and Pages deployment outcomes must be verified for the final cleanup commit before reporting completion.
