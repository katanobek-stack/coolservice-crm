# ППЗ: рабочее пространство

Owner request: inspect and redesign the whole PPZ area using design and development skills. Implementation choices below are agent decisions within that request, retaining current server semantics.

## Intent
Make active assignments easy to find and execute without scrolling through every report and upload form. Keep shared completion distinct from personal contribution, and preserve all existing data, role gates, daily-plan publication and photo functionality.

## Approach
Use the current React/TypeScript/Firebase stack and existing callable endpoints. Separate shared tasks and daily planning with explicit workspace navigation; preserve mounted editors while switching views. Use compact native details cards so disclosure preserves form state. Keep administrator accounting on demand. Do not add a parallel task store.

An all-new kanban model would invent workflow/status semantics; backend task editing/deadlines/priority would require server deployment and migration outside this UI improvement. Instead provide search, status/employee filters, counts, contextual empty states and explicit feedback on the existing model. Optional task deadlines are not added to undated shared tasks.

## Design
Use the CRM Manrope font and existing palette: base #F5F7FA, white #FFFFFF, ink #172B45, blue #2563EB, muted #63758B, line #DCE5EF. Retain theme variables rather than changing the whole CRM. Left-aligned task titles, quiet metadata and visible status labels; no decorative imagery. A clear workspace header, segmented navigation and compact task summaries carry the hierarchy. Detail sections separate assignment context, shared photos, employee contributions and own report. Use keyboard-native disclosure, visible focus, reduced motion and wide mobile layout; no 320/390 viewport testing.

## Behavior
- Search title, description, assigned names and creator without extra database queries. Combine text, employee and open/in-progress/done filters; summaries count the employee/search scope before status filtering.
- Show only authenticated permitted snapshots. Never widen manager/mechanic access in client code.
- Shared close stays global; personal work credit remains individual. Confirm shared closing with the number of assigned employees.
- New-task form is optional, labeled, validates trimmed title/assignees and remains intact on failure. Reuse task/request IDs on retry with the same normalized input; generate new IDs when the logical request changes.
- Clear success and failure feedback; no claim that a queued Telegram message is delivered.
- Preserve comments/photos and existing draft conflict protections. Switching workspace sections does not discard edits. Filtered task cards stay mounted, preserving input while filtering.

## Acceptance
Verify combined search/status/employee filtering, counts, legacy records, no-match versus empty, stable create retries, changed-input IDs, permission-gated report/photo UI, shared closure protection and the existing PPZ/photo tests. Run web typecheck, unit tests and build; broader tests require emulator setup. Inspect rendered desktop and wide mobile preview; label demonstration data. Do not send production notifications or create live tasks for testing.

## Verification record

- Web TypeScript checks and production build passed (existing bundle-size warning remains).
- Full web npm test passed in Firestore emulator: 212 tests, no failures.
- Server daily-plan logic: 12 tests passed; shared-task/daily-plan integration: 31 passed in emulator. No backend or rules changes.
- Independent fresh-context code review found no concrete regressions in retry IDs, legacy records, role gates, report state retention and daily-plan publication.
- Browser on the actual shared-task UI component with synthetic data: combined search, native card disclosure, report draft retention after filtering, cancelled shared close, failed assignment retaining input, successful retry with one task, desktop and 480px mobile layout checked. No 320/390 checks.
- Production login page loaded, but authenticated production task creation/completion was not exercised; no test tasks or Telegram messages were written to production.
- Temporary noindex QA pages were removed after verification.
