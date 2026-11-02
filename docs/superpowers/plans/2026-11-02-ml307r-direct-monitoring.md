# ML307R Direct Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Show a separately authenticated ML307R controller online in Monitoring via direct HTTPS and add accurate SIM balance support.
**Architecture:** Existing ingestion writes Firebase; optional status extensions preserve the legacy MQTT contract. ESP32 uses the bench-proven mbedTLS/TCP transport, never direct database credentials.
**Tech Stack:** Firebase Functions/Firestore, React/TypeScript, Arduino ESP32, ML307R AT commands.
**Spec:** ../specs/2026-11-02-ml307r-direct-monitoring.md

## Global Constraints

- Keep device-001, VPS, broker and old payloads unchanged.
- New ID coolmonitor-ml307r-001; create-only provisioning; never log raw keys.
- No invented sensor readings; no certificate verification bypass.
- No commits/pushes. Reuse the suitable current checkout on a feature branch.

## Review Focus

- Legacy messages without extensions still work.
- Unknown/malformed balance fields are rejected; zero/negative real balances are valid.
- Balance failure preserves last known amount/time; old attempts cannot roll it back.
- Wrong device key and duplicate status IDs cannot change current state.
- Public UI must distinguish HTTPS connectivity, missing balance and missing temperature.

### Task 1: Backward-compatible status extensions
Files: functions/src/controllerStatusExtensions.ts, controllerStatus.ts; functions/tests/controllerStatusExtensions.test.js and telemetry.emulator.test.js.
Interfaces: parseStatusExtensions(body, parseUtc) returns optional transport and parsed balance; storedSimBalance(previous, incoming, timestamp) preserves last known success.
- [x] Write tests for legacy payload, HTTPS, balance zero/negative, malformed balance, failure preserving previous success and stale attempt.
- [x] Run RED, implement, run GREEN and Functions build; run integration tests with emulators if available.

### Task 2: Monitoring display
Files: web/src/shared/types/monitoring.ts, shared/firebase/monitoring.ts, features/monitoring/MonitoringTab.tsx; tests/monitoring.test.ts.
- [x] Test balance presentation and HTTPS/legacy transport labels.
- [x] Map optional extensions; show balance, last successful time and unavailable/error state; preserve existing graphs.
- [x] Run web typecheck, unit tests and production build.

### Task 3: Provision and direct firmware
Files: functions/scripts/provision-ml307r-controller.js; ESP32 firmware/ml307r_direct_status and ignored device_config.h.
- [x] Provision only the specified new registry/credential documents, after verifying ID availability; record no raw key in logs.
- [x] Bench-test balance support and trusted autonomous UTC, reuse TLS transport, send real status every 30 seconds with stable retry IDs.
- [x] Build/flash COM7 after releasing the live monitor; prove HTTP 202/200 and Firebase read-back for this ID.

### Task 4: Deploy and verify
- [x] Review diff/security/legacy compatibility; scoped deployment of changed ingestion completed.
- [x] Verify old device registry/status unchanged, new controller visible/online, no fake temperature, accurate balance status.
- [x] Record evidence and outstanding hardware/long-run limits in CONTROLLER_PROFILE.md and this task ledger.

- [ ] Publish prepared frontend through existing workflow after explicit commit/push authorization. See progress ledger for Java/emulator and actual SIM balance limitations.
