# Заявки и приёмка: рабочее пространство

User asks to redesign both areas using the established PPZ/dashboard design and preserve all data. Existing authorization covers implementation, commit/push and deployment. Product choices below are the implementer's decisions under the same delegated approach, not separate user approvals.

## Result
- Keep two existing routes. Заявки has client repairs and service tasks as separate internal views. Приёмка keeps walk-in cars and chambers and its manager hand-off in Отчёты.
- Shared header, toolbar, status filters and compact disclosure cards. Search client, plate (Cyrillic/Latin lookalikes), equipment, descriptions, task descriptions and staff. Filter by personal scope/employee, status and intake equipment type. Newest/oldest sorting and explicit reset.
- Summaries show equipment/client, state, date, assignees and actual task progress; all existing work controls, comments, reports, photos and client navigation remain available on expansion.
- Managers can inspect awaiting-close repairs and client archive; mechanics retain their existing active assigned task scope in Заявки. Intake permissions remain as currently allowed by Firestore rules for all authenticated staff. No new role grants, no change to shared completion semantics.
- Cancelled and manager-closed repairs are never called active. Completed tasks awaiting manager confirmation are clearly labeled. Active/ready and archive choices do not change documents.
- Each source has loading/error/empty/no-match states. A failed save retains entered values and offers retry. Deletion remains an explicit existing confirmation inside expanded details, never a summary action.

## Preservation boundary
No schema migration, bulk write, data deletion, record duplication, backend/rules change, telemetry or SaaS work. Existing transactional editors and closure transfer are reused. All production data remains in the same collections/IDs. No real records or notifications for QA. Archive data is not erased by display filters. Invalid/legacy optional fields are tolerated.

## Design
Manrope, current theme: canvas #f8fafc, surface #ffffff, muted #f1f5f9, border #e2e8f0, text #1e293b, accent #2563eb. Left aligned headers, underline view navigation, quiet bordered panels, native disclosures with visible focus; blue for selection and green only for completed work. Compact metadata and large enough action targets. No decorative gradients or motion. Desktop and 480 CSS px validation; never 320/390.

## Approaches considered
Cosmetic restyle alone would leave long unsearchable lists; merging collections/routes would add unnecessary data risk. Chosen by implementer: shared presentation/filter layer over the current source arrays and editors, preserving the route and persistence boundaries.

## Verification
Behavior tests for role scope, archive/ready separation, plate search, combined filters, missing fields and no array mutations. SSR tests for accessible disclosures, loading/error states and retained children. Full existing typecheck/build/unit and Firestore emulator suites. Fresh review. Browser synthetic preview of actual shared components on desktop/480; production login only if no authenticated session. Authorized publish through existing GitHub Pages workflow; remove temporary QA pages.
