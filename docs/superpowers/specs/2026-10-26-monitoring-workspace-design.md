# Мониторинг: цветное рабочее пространство

User asks for a more colorful, professional, usable and extensible CRM monitoring page while preserving all stored structures/data. Existing session authorizes implementation and publishing. Design choices below are implementer decisions under that delegated brief.

## Chosen approach
Keep Firebase data paths, telemetry/heartbeat ingestion, histories, sensor identifiers and callable rule APIs. Add a presentation/status layer and improve source ownership handling. A restyle alone leaves contradictory status calculations; a backend rewrite adds data risk and is outside scope.

## Result
- Navy/cyan command header on a pale blue workspace; tinted blue/green/amber/red status tiles and device surfaces. Colors have text labels: alarms red, stale/missing/disconnected amber, fresh data blue/cyan, disabled neutral. Fresh data never claims safe temperature.
- Four enabled-device summary filters: monitored, heartbeat+fresh readings, attention (including actual alarms), devices with alarms. Count alarm events separately and label them precisely. Disabled devices remain accessible through an explicit filter, do not inflate current attention counts.
- Multiword search by name/technical id/client/object/plate; target and enabled filters; attention/name/latest-reading sort; reset and source-ready result counts. Problem devices first by default.
- Full history remains in selected-controller details. Remove all-device background miniature-history listeners from overview, reducing subscriptions as registry grows. This removes no stored history.
- Detail views: Temperatures/graphs, Connection/diagnostics, Temperature rules. Retain all chart periods, zoom/pan, estimated/delayed time semantics, actual per-sensor history and thresholds. Stable sensor accent colors distinguish series while delayed segments remain orange.
- Heartbeat connectivity is the one definition across tiles, list, filters and details; measurement freshness is independent. Date labels use Vladivostok. Registry/settings/current-state/heartbeat readiness and failures are explicit; no stale healthy counters on source failure.
- Clear selected-device sensor data immediately and gate it by owner and both listener readiness. Guard abandoned callbacks. Scope rules and history by device/period so switching devices cannot display prior readings/rules/graphs under a new title. Missing/error states stay distinct from no sensors.
- Manager/admin/owner retain current rename/threshold/rule rights; mechanics read-only. No commands, new hardware control, alert acknowledgement or rule changes during QA. Existing single global alert center remains the source of alert actions.

## Preservation
No migrations, collection changes, production test records, bulk updates, telemetry changes, real notifications, record deletion, backend or rules change. Disabled/test/unassigned records remain discoverable. Legacy default sensor fallback remains after confirmed empty modern registry/state. No fake health thresholds, debt or temperatures. Settings remain explicit user actions with errors and retained input.

## Design tokens
Manrope; command navy #12304a, cyan #0891b2, blue #2563eb, green #158065, amber #a7660e, red #bd3636; surfaces #eaf1f8/#eff7ff/#fff8e8/#fff2f1. Same navigation rhythm as PPZ/dashboard but with meaningful color blocks, no decorative motion. Desktop and480 CSS px QA, never320/390.

## Verification
Red/green tests for heartbeat-vs-delivery divergence, alarms/disabled scope, multi-filter/sort, invalid readings, selection ownership/legacy fallback and source failures. SSR actual overview tests for colors-as-state and honest unknown values. Existing typecheck/build/full web emulator suite, fresh code review, synthetic actual-route browser QA desktop/480 including charts, role guards and failed settings writes. Authorized GitHub publish and QA cleanup; production sign-in limitation stated.
