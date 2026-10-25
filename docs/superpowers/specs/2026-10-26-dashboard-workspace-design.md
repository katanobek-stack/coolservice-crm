# Dashboard workspace

Owner authorizes redesign and implementation using the PPZ visual style and agent judgment. Keep React/TypeScript, current Firebase data sources and existing backend/rules. Do not add costs, new dependencies or invented business data.

## Structure and visual choices
Reuse PPZ's Manrope typography, quiet white surfaces, slate text, blue selection accents, subtle borders and explicit labels. Scope styles to dashboard. Use Overview, Analytics and Team sections, retaining form/view state with hidden mounted sections where applicable. Move long analysis and administrator work accounting off the default operational screen. Prefer focused rows and labeled controls over animated decorative cards.

Overview: actionable counters and filters for active client/intake requests, ready-to-close requests, no-assignee work and requests aged seven days. Seven days describes age, not an invented deadline. Show today's Vladivostok appointments, real monitoring readiness/errors, quick links including PPZ, and current-month revenue only with permission. Search by customer, equipment, plate, description and employee. Keep client/intake source labels and avoid double counting the intake-to-client move.

Analytics: preserve revenue/month detail, clients, service types, loyalty and freon reports; label all-time versus recent/current periods. Respect financial permissions for amounts, chart geometry, percentages and detail modals. Use historical fixed-cost rental snapshots consistently. Keep existing global financial-period helper semantics; this is not a migration of reporting dates. Use business timezone for operational today/current reporting month.

Team: preserve workload and owner-only revenue allocation, label assignments as workload rather than performance/quality, remove decorative crowns. Open the administrator work-accounting panel on demand. Do not broaden read permissions.

## Correctness
Track each data source's first successful/error response, rather than incrementing a shared count on repeated snapshots. Distinguish loading, unavailable and empty. Do not infer normal temperature from missing/failed monitoring streams. Exclude disabled monitoring devices from active alarms/counts.

Merge client and intake repairs using stable repair identity for transfer deduplication; preserve distinct client record identities. Separate ready-for-manager closure from active work. Parse localized numeric amounts safely and never expose unauthorized totals through fallback widgets or dialogs. Do not mutate source arrays or production records.

## Verification
Test readiness, permission matrix, intake transfer/deduplication, missing legacy fields, cancelled/closed/ready statuses, search/attention filters, Vladivostok midnight, localized amounts and historical rentals. Retain existing unit and emulator suites. Review code independently, inspect rendered desktop and 480 CSS-pixel mobile with labeled synthetic data; do not test 320/390. Verify CI/deployment and remove temporary QA pages. Authenticated production writes are outside visual tests.
