# Service monitor workspace

**Goal:** Extend the CRM visual language to service-controller diagnostics and make fleet triage, logs and diagnostic commands clear and reliable.

**Authority:** User delegated feature choices under the same rules as Personnel and explicitly requested commit, push and deployment. Reuse current clean codex/crm-current-workspace, synchronized at 6243791. No additional design questions. No live controller commands or production writes during testing.

**Architecture:** Keep Firestore/callable contracts, existing 5-minute heartbeat/MQTT precedence, and manager+ command access. Add pure workspace selectors/formatters, a supplied-data workspace, keyed detail/log panels, and scoped subscriptions for the selected controller. Add manager-only last-20 command history via existing readable commands subcollection. Registry stays read-only. No backend, firmware, rules or index changes and no new dependencies.

**Behavior:** Fleet KPI and search/status/attention/sort filters; explicit disabled/never-contacted/offline/online states; signal/GPRS/UART attention reasons with unknown values preserved. Latest contact and timestamps use Asia/Vladivostok. Diagnostic cards explain commands in plain Russian. A queue acknowledgement never implies execution. Render server command statuses and results. Log search/severity, frozen pause snapshot, resume and text export of visible records (latest 150 received records, never claim full history). Source loading/error states hide stale data and disable dependent actions. Ref lock prevents rapid duplicate submission, and late command feedback stays associated with its controller.

## Review focus
- Selection changes cannot show another controller's logs, history or command feedback.
- Registry errors cannot show stale confirmed KPIs or send commands.
- Missing connection/diagnostic values do not become invented failures or successes.
- Paused logs stay frozen, including export; failed sources cannot export stale records.
- Mechanic roles never subscribe to privileged command history or send commands; queue success is not controller completion.

## Tasks
- [x] Add RED tests for selectors, status explanations, time/formatting, command history normalization and log filtering/export; implement pure logic and mapping.
- [x] Add RED supplied-data rendering tests for readiness, role gates and disabled controllers; implement responsive workspace, diagnostics/log/history panels.
- [x] Replace ServiceMonitorTab with scoped/retryable subscriptions and guarded submission. Test controller switching and pause/resume with synthetic data in browser.
- [x] Run typecheck, full emulator suite, production build and independent code review; address important findings.
- Release: fetch/merge any new main commits, review split/map calls, commit/push and verify CI, Pages deployment and live release.

## Verification record
- Typecheck and Vite production build passed; existing bundle-size warning remains.
- Full npm test with FIRESTORE_EMULATOR_HOST=127.0.0.1:8080: 331/331 pass, zero skipped/cancelled, exit 0. Emulator launched directly with the cached official JAR/JRE. Firebase CLI15 wrapper had a post-test shutdown timeout; the direct run uses the same rules/runtime. An initial direct bootstrap mistakenly enabled single-project mode (a Boolean presence flag); discarded that run and relaunched without that flag. No product changes were needed for either harness issue.
- Independent reviewer found no important bugs; clarified dispatched status to 'Ожидает ответа' rather than implying device receipt.
- Browser QA at 1280x960 and 390x844: no horizontal overflow; search combines filters, disabled controllers cannot send, mechanic controls/history hidden, switching clears logs, failure hides registry/details, paused export contains exactly the visible snapshot, resume shows new data. Synthetic-only commands and data; no real device commands or production writes.
- Reviewed all new split/map calls: inputs originate from normalized arrays/strings or explicit state defaults. Temporary previews and downloaded test log removed. Current origin/main unchanged at 6243791 before release.
- Publication outcome is recorded by the release commit's GitHub Actions runs and this chat, after this pre-publication verification record.
