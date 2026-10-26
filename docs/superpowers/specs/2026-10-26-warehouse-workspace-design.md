# Склад: оборудование и аренда

Owner delegates redesign decisions to the implementer and asks to continue the established PPZ/dashboard/requests/client workspace style. Preserve the carefully developed camera SVG and rental animation. Use existing React/TypeScript and Firebase, no dependencies or migrations.

## Approach
Cosmetic changes alone leave equipment hard to find; replacing the camera graphics discards explicitly valued work. Chosen implementation: a presentation and selection layer over existing freezer documents, with original illustrated cards as the default and a compact table for scanning. Reuse transactional mutation helpers and collection/IDs. No writes for visual QA.

## Structure
Manrope, navy headings #14324a, pale blue #eaf1f8, white surfaces, slate borders, blue selection and teal available-state accents. Clear labels and visible field boundaries; color is supplementary. Header, actionable summary, All/Available/Rented navigation, search, equipment type and payment-attention filters, name/payment-date/volume sort, grouped cards by rental status and optional table. Summaries distinguish loading/error/empty. Payment attention uses actual paidUntil strictly before the business date in Asia/Vladivostok; unknown dates remain unknown and do not invent debt. Paid through today is not overdue. Localized amounts and invalid optional fields are tolerated.

Details: bounded equipment, rental and electricity sections; original history, editing, rental start/end, meter and deletion retained. Source data remains live; disappearance of selected records never falls back to stale editable snapshots. Save failures keep forms and inputs open, clear saving state and show an actionable error. Numeric form fields reject invalid negative values; meter must not precede starting reading. Current role rules retained, no new data grants. Aggregate rental amount remains management-only as before.

## Preservation and verification
Keep the complete FreezerIllustration geometry, unique gradients, fan/air/snow motion and reduced-motion rules. Motion is decorative rental state, not telemetry. Scope styling to warehouse and its portal modals. Desktop and 480 CSS px must fit, long text must wrap. Test search/filter combinations, legacy rental flags, business midnight, invalid dates and amounts, no array mutation, source readiness and manager/mechanic rendering; retain existing illustration tests. Typecheck, unit suite, production build, independent review and real browser QA with fictional fixtures and no Firebase writes. Remove temporary QA pages before delivery. Existing publication authorization covers commit/push/deploy once verified.
