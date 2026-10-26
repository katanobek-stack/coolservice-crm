# Клиенты: каталог и карточка обслуживания

User requests a client workspace matching the established PPZ/dashboard/request design, with CRM-like sorting and grouping instead of a continuous row. Implementation choices are delegated by the ongoing same-style redesign workflow; no separate approval is invented.

## Approach and result
A cosmetic change leaves the main problem; replacing customer storage adds unnecessary risk. Implement a presentation-only directory over existing clients and the existing editing/detail flows.
- Responsive grouped grid by default, optional compact table. Default alphabetical sorting and letter groups. Alternative groups by service activity and client type; sorts by name, recent repair, number of open repairs and creation date.
- Type filters (current physical/legal route plus all), search across names/company/previous name/contact/INN/phone/car plates/brands/chamber notes. Preserve legacy clientType/type precedence. Normalize plate lookalikes and phone punctuation.
- Service filters: all, open repairs, awaiting manager, no repair history, missing phone. Equipment filters for vehicles/chambers/no equipment. Display actual counts only after clients source ready. No invented debt/financial badges or inactivity deadlines.
- Each card is a distinct client with contact, equipment counts, open/ready work, last repair and an explicit Open button. Alphabet grouping uses business names without common legal prefixes (ООО/АО/ПАО/ЗАО/ОАО/ИП); original names are displayed and stored unchanged.
- Profile is a larger responsive modal with Overview, Equipment, Work, History and Appointments views. All existing controls, legacy appointments, photos, reports, conversion history, client edits and permitted actions remain available. Native buttons for keyboard opening, live selected record and external vehicle deep links retained.
- Loading/error/no-match/empty states, error feedback for touched add/edit client forms, preservation of entered text on failure. Existing Firebase transactional mutation helpers and role/financial visibility policies remain unchanged.

## Constraints
No migrations/bulk writes, no real QA records, no record merging or deletion, no backend/rules/new dependency. Keep original IDs and collection shape. Editing/deletion occur only via existing explicit UI actions. Avoid stale selected snapshots after a real record disappears. Retain pending deep links until clients are loaded.

## Design
Existing Manrope, canvas #f8fafc, white panels, #e2e8f0 borders, #1e293b text and #2563eb accents. Left aligned information; quiet outlined controls; distinct letter headers and consistent grid gutters. Type/activity are informative badges, no decorative avatars or large photo walls. Desktop/480 CSS px QA; never 320/390.

## Acceptance
Pure selector tests for prefix sorting, type compatibility, normalized search, closed/cancelled/explicitly reopened work, combined filters, missing fields/dates and no source mutation. SSR directory tests for grouped layout, opening controls and unavailable/loading states. Browser real components with synthetic context and blocked writes, desktop and 480. Full existing unit/typecheck/build/Firestore suite, fresh review, authorized GitHub deploy and temporary QA cleanup. Authenticated production checks only if a session already exists.
